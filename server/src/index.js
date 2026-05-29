const express = require('express');
const cors = require('cors');
const projectsRouter = require('./routes/projects');
const requestsRouter = require('./routes/requests');
const environmentsRouter = require('./routes/environments');
const proxyRouter = require('./proxy');

const app = express();
const PORT = 3001;

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

app.use('/api', projectsRouter);
app.use('/api', requestsRouter);
app.use('/api', environmentsRouter);
app.use('/api/proxy', proxyRouter);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
