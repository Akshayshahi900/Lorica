import { parseFile } from ".";

const result = parseFile(
  "test.ts",
  `
export async function createExpense(req, res) {
  const amount = req.body.amount;

  if (amount <= 0) {
    return res.status(400).json({
      message: "Invalid amount"
    });
  }

  return res.json({ amount });
}
`
);

const root = result!.tree.rootNode();

function walk(node: any, depth = 0) {
  const indent = "  ".repeat(depth);

  console.log(
    `${indent}${node.kind()} [${node.startPosition().row + 1}:${node.startPosition().column}]`
  );

  for (let i = 0; i < node.childCount(); i++) {
    const child = node.namedChild(i);

    if (child) {
      walk(child, depth + 1);
    }
  }
}

walk(root);