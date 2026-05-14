db = db.getSiblingDB("appdb");

db.createUser({
  user: "appuser",
  pwd: "apppassword",
  roles: [{ role: "readWrite", db: "appdb" }],
});

db.users.insertMany([
  { name: "Alice", email: "alice@example.com", createdAt: new Date(), active: true },
  { name: "Bob", email: "bob@example.com", createdAt: new Date(), active: true },
  { name: "Carol", email: "carol@example.com", createdAt: new Date(), active: false },
]);

db.orders.insertMany([
  { userId: "alice", product: "Widget A", qty: 2, price: 19.99, status: "shipped", createdAt: new Date() },
  { userId: "bob", product: "Widget B", qty: 1, price: 49.99, status: "pending", createdAt: new Date() },
  { userId: "alice", product: "Widget C", qty: 5, price: 9.99, status: "delivered", createdAt: new Date() },
  { userId: "carol", product: "Widget A", qty: 3, price: 19.99, status: "cancelled", createdAt: new Date() },
]);

db.products.insertMany([
  { name: "Widget A", sku: "WGT-A", price: 19.99, stock: 100 },
  { name: "Widget B", sku: "WGT-B", price: 49.99, stock: 50 },
  { name: "Widget C", sku: "WGT-C", price: 9.99, stock: 200 },
]);

print("init-mongo.js: seed data inserted into appdb");
