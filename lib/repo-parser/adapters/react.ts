import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { RepoFile } from "../index";
import { hasDependency, readPackageManifest } from "./manifest";
import type { AdapterResult, FrameworkAdapter } from "./types";

function analyzeFile(root: string, file: RepoFile) {
  const absolutePath = path.join(root, file.path);
  const source = fs.readFileSync(absolutePath, "utf8");
  const extension = path.extname(file.path).toLowerCase();
  const scriptKind = extension === ".tsx" ? ts.ScriptKind.TSX : extension === ".jsx" ? ts.ScriptKind.JSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(absolutePath, source, ts.ScriptTarget.Latest, true, scriptKind);
  const roles = new Set<string>();

  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name && /^use[A-Z0-9]/.test(node.name.text)) roles.add("Hooks");
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /^use[A-Z0-9]/.test(node.name.text)) roles.add("Hooks");
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "createContext") roles.add("Contexts");
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "createContext") roles.add("Contexts");
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name && /^[A-Z]/.test(node.name.text)) {
      let containsJsx = false;
      const findJsx = (child: ts.Node) => {
        if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) containsJsx = true;
        if (!containsJsx) ts.forEachChild(child, findJsx);
      };
      findJsx(node);
      if (containsJsx) roles.add("Components");
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /^[A-Z]/.test(node.name.text) && node.initializer) {
      let containsJsx = false;
      const findJsx = (child: ts.Node) => {
        if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) containsJsx = true;
        if (!containsJsx) ts.forEachChild(child, findJsx);
      };
      findJsx(node.initializer);
      if (containsJsx) roles.add("Components");
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return roles;
}

export const reactAdapter: FrameworkAdapter = {
  framework: "react",
  matches(root) {
    return hasDependency(readPackageManifest(root), "react");
  },
  analyze(root, files: RepoFile[]): AdapterResult {
    const roles: AdapterResult["roles"] = [];
    for (const file of files) {
      for (const roleName of analyzeFile(root, file)) roles.push({ path: file.path, roleName });
    }
    return { framework: "react", roles, routes: [] };
  },
};
