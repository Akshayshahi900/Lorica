import express from 'express';
const app = express();
app.use(express.json());

// app.use('/api', verifyAuth); // ALl '/api' routes  are protected 
console.log("Starting the backend server...");
app.get('/', (req, res) => {
  console.log("Hello from the backend server!");
  res.send('Hello from the backend server!');
});
app.post("/webhooks/github", (req, res) => {
  console.log("Webhook received!");
  console.log(req.headers);
  console.log(req.body);

  res.sendStatus(200);
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});