import express from "express";

const app = express();
app.get("/forecast/:city", (req, res) => {
  res.json({ city: req.params.city, forecast: "sunny" });
});

export default app;
