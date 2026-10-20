import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { RepoFile } from "../index";
import { hasDependency, readPackageManifest } from "./manifest";
import type { AdapterResult, FrameworkAdapter, FrameworkRoute } from "./types";

const METHOD_DECORATORS: Record<string, string> = {
  Get: "GET",
  Head: "HEAD",
  Options: "OPTIONS",
  Post: "POST",
  Put: "PUT",
  Patch: "PATCH",
  Delete: "DELETE",
  All: "ALL",
};

function importedNestDecorators(sourceFile: ts.SourceFile) {
  const names = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== "@nestjs/common") continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) names.set(element.name.text, (element.propertyName ?? element.name).text);
  }
  return names;
}

function decoratorName(decorator: ts.Decorator, imported: Map<string, string>): string | null {
  const expression = decorator.expression;
  const target = ts.isCallExpression(expression) ? expression.expression : expression;
  if (!ts.isIdentifier(target)) return null;
  return imported.get(target.text) ?? null;
}

function decoratorStringArg(decorator: ts.Decorator): string | null {
  if (!ts.isCallExpression(decorator.expression)) return null;
  const argument = decorator.expression.arguments[0];
  return argument && ts.isStringLiteralLike(argument) ? argument.text : null;
}

function getDecorators(node: ts.Node) {
  return ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
}

function joinPattern(controllerPath: string, methodPath: string) {
  const combined = [controllerPath, methodPath].filter(Boolean).join("/").replace(/\/{2,}/g, "/");
  return combined ? `/${combined.replace(/^\/+|\/+$/g, "")}` : "/";
}

function analyzeController(root: string, filePath: string): FrameworkRoute[] {
  const absolutePath = path.join(root, filePath);
  const source = fs.readFileSync(absolutePath, "utf8");
  const sourceFile = ts.createSourceFile(absolutePath, source, ts.ScriptTarget.Latest, true);
  const imported = importedNestDecorators(sourceFile);
  const routes: FrameworkRoute[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isClassDeclaration(statement)) continue;
    const controllerDecorator = getDecorators(statement).find((decorator) => decoratorName(decorator, imported) === "Controller");
    if (!controllerDecorator) continue;
    const controllerPath = decoratorStringArg(controllerDecorator);
    if (controllerPath === null) continue;

    for (const member of statement.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      for (const decorator of getDecorators(member)) {
        const name = decoratorName(decorator, imported);
        const method = name ? METHOD_DECORATORS[name] : undefined;
        if (!method) continue;
        const methodPath = decoratorStringArg(decorator);
        if (methodPath === null) continue;
        routes.push({ method, path: joinPattern(controllerPath, methodPath), sourceFile: filePath });
      }
    }
  }

  return routes;
}

export const nestJsAdapter: FrameworkAdapter = {
  framework: "nestjs",
  matches(root) {
    return hasDependency(readPackageManifest(root), "@nestjs/core");
  },
  analyze(root, files: RepoFile[]): AdapterResult {
    const roles: AdapterResult["roles"] = [];
    const routes: FrameworkRoute[] = [];
    for (const file of files) {
      const name = path.posix.basename(file.path).toLowerCase();
      let roleName: string | undefined;
      if (/\.controller\.[cm]?[jt]sx?$/.test(name)) roleName = "Controllers";
      else if (/\.service\.[cm]?[jt]sx?$/.test(name)) roleName = "Services";
      else if (/\.module\.[cm]?[jt]sx?$/.test(name)) roleName = "Modules";
      else if (/\.entity\.[cm]?[jt]sx?$/.test(name)) roleName = "Entities";
      if (roleName) roles.push({ path: file.path, roleName });
      if (roleName === "Controllers") routes.push(...analyzeController(root, file.path));
    }
    return {
      framework: "nestjs",
      roles,
      routes: routes.sort((left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method) || left.sourceFile.localeCompare(right.sourceFile)),
    };
  },
};
