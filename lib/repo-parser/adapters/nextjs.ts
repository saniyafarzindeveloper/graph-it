import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { RepoFile } from "../index";
import { hasDependency, readPackageManifest } from "./manifest";
import type { AdapterResult, FrameworkAdapter, FrameworkRoute } from "./types";

const HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS", "POST", "PUT", "DELETE", "PATCH"]);
const PAGE_EXCLUSIONS = new Set(["_app", "_document", "_error"]);

function extensionOf(filePath: string) {
  return path.posix.extname(filePath).toLowerCase();
}

function hasDirectivePrologue(statements: readonly ts.Statement[], value: string) {
  for (const statement of statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === value) return true;
  }
  return false;
}

function containsServerAction(filePath: string) {
  const source = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  if (hasDirectivePrologue(sourceFile.statements, "use server")) return true;
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.body && ts.isBlock(node.body)) {
      if (hasDirectivePrologue(node.body.statements, "use server")) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function appRootIndex(parts: string[]) {
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (parts[index] === "app" && (index === 0 || (index === 1 && parts[0] === "src"))) return index;
  }
  return -1;
}

function pagesRootIndex(parts: string[]) {
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (parts[index] === "pages" && (index === 0 || (index === 1 && parts[0] === "src"))) return index;
  }
  return -1;
}

function appPath(parts: string[], rootIndex: number): string | null {
  const segments = parts.slice(rootIndex + 1, -1);
  if (segments.some((segment) => segment.startsWith("@") || /^\(\.{1,3}\)/.test(segment))) return null;
  return `/${segments.filter((segment) => !(segment.startsWith("(") && segment.endsWith(")"))).join("/")}` || "/";
}

function pagesPath(parts: string[], rootIndex: number): string {
  const segments = parts.slice(rootIndex + 1, -1);
  if (segments.at(-1) === "index") segments.pop();
  return `/${segments.join("/")}` || "/";
}

function exportedHttpMethods(filePath: string): string[] {
  const source = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const methods = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      if (HTTP_METHODS.has(statement.name.text)) methods.add(statement.name.text);
    }
    if (ts.isVariableStatement(statement) && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && HTTP_METHODS.has(declaration.name.text)) methods.add(declaration.name.text);
      }
    }
  }
  return [...methods].sort();
}

function pagesApiHttpMethods(filePath: string): string[] {
  const source = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const handlers: ts.Node[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
      handlers.push(statement);
    }
    if (ts.isExportAssignment(statement) && !statement.isExportEquals && (ts.isArrowFunction(statement.expression) || ts.isFunctionExpression(statement.expression))) {
      handlers.push(statement.expression);
    }
  }

  const methods = new Set<string>();
  for (const handler of handlers) {
    const parameters = ts.isFunctionLike(handler) ? handler.parameters : [];
    const requestName = parameters[0] && ts.isIdentifier(parameters[0].name) ? parameters[0].name.text : null;
    if (!requestName) continue;
    const isRequestMethod = (node: ts.Expression) => ts.isPropertyAccessExpression(node) && node.name.text === "method" && ts.isIdentifier(node.expression) && node.expression.text === requestName;
    const visit = (node: ts.Node) => {
      if (ts.isSwitchStatement(node) && isRequestMethod(node.expression)) {
        for (const clause of node.caseBlock.clauses) {
          if (ts.isCaseClause(clause) && ts.isStringLiteralLike(clause.expression) && HTTP_METHODS.has(clause.expression.text)) {
            methods.add(clause.expression.text);
          }
        }
      }
      if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken].includes(node.operatorToken.kind)) {
        const candidate = isRequestMethod(node.left) && ts.isStringLiteralLike(node.right)
          ? node.right.text
          : isRequestMethod(node.right) && ts.isStringLiteralLike(node.left)
            ? node.left.text
            : null;
        if (candidate && HTTP_METHODS.has(candidate)) methods.add(candidate);
      }
      ts.forEachChild(node, visit);
    };
    visit(handler);
  }
  return [...methods].sort();
}

function addRole(roles: Map<string, Set<string>>, filePath: string, roleName: string) {
  const names = roles.get(filePath) ?? new Set<string>();
  names.add(roleName);
  roles.set(filePath, names);
}

export const nextJsAdapter: FrameworkAdapter = {
  framework: "next",
  matches(root) {
    return hasDependency(readPackageManifest(root), "next");
  },
  analyze(root, files: RepoFile[]): AdapterResult {
    const roles = new Map<string, Set<string>>();
    const routes: FrameworkRoute[] = [];

    for (const file of files) {
      const parts = file.path.split("/");
      const base = path.posix.basename(file.path, extensionOf(file.path));
      const appIndex = appRootIndex(parts);
      const pagesIndex = pagesRootIndex(parts);

      if (appIndex >= 0 && (base === "page" || base === "route")) {
        const role = base === "page" ? "Page routes" : "API endpoints";
        addRole(roles, file.path, role);
        const pattern = appPath(parts, appIndex);
        if (pattern !== null && base === "page") routes.push({ method: "PAGE", path: pattern, sourceFile: file.path });
        if (pattern !== null && base === "route") {
          for (const method of exportedHttpMethods(path.join(root, file.path))) {
            routes.push({ method, path: pattern, sourceFile: file.path });
          }
        }
      } else if (pagesIndex >= 0) {
        const pageSegments = parts.slice(pagesIndex + 1, -1);
        const isApi = pageSegments[0] === "api";
        if (isApi) {
          addRole(roles, file.path, "API endpoints");
          const pattern = pagesPath(parts, pagesIndex);
          for (const method of pagesApiHttpMethods(path.join(root, file.path))) {
            routes.push({ method, path: pattern, sourceFile: file.path });
          }
        } else if (!PAGE_EXCLUSIONS.has(base)) {
          addRole(roles, file.path, "Page routes");
          routes.push({ method: "PAGE", path: pagesPath(parts, pagesIndex), sourceFile: file.path });
        }
      }

      if (containsServerAction(path.join(root, file.path))) addRole(roles, file.path, "Server actions");
    }

    return {
      framework: "next",
      roles: [...roles].flatMap(([filePath, names]) => [...names].map((roleName) => ({ path: filePath, roleName }))),
      routes: routes.sort((left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method) || left.sourceFile.localeCompare(right.sourceFile)),
    };
  },
};
