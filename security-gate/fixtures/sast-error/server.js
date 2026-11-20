// PLANTED FINDINGS for the gate's selftest. Never import this.
const express = require("express");
const { exec } = require("child_process");
const app = express();
app.get("/run", (req, res) => {
  exec("ls " + req.query.dir, (err, out) => res.send(out));
  res.send(eval(req.query.expr));
});
