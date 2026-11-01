const app = require("./index");
const http = require("http");

const hostname = "0.0.0.0";
const port = process.env.PORT || 5000;

const server = http.createServer(app);

server.listen(port, hostname, () => {
  console.log(`✓ Server running on port ${port}`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`✗ Error: Port ${port} is already in use`);
    process.exit(1);
  }

  console.error(err);
  process.exit(1);
});
