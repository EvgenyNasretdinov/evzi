type Resolver = (decision: "approve" | "reject") => void;

const registry = new Map<string, Resolver>();

export function register(id: string, resolve: Resolver) {
  registry.set(id, resolve);
}

export function settle(id: string, decision: "approve" | "reject") {
  const fn = registry.get(id);
  if (!fn) return;
  registry.delete(id);
  fn(decision);
}

export function size() { return registry.size; }
