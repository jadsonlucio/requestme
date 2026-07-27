const express = require('express');
const cors = require('cors');
const projectsRouter = require('./routes/projects');
const requestsRouter = require('./routes/requests');
const environmentsRouter = require('./routes/environments');
const proxyRouter = require('./proxy');

const app = express();
const PORT = 3001;

app.use(cors({ origin: 'http://localhost:5173' }));
// Default body-parser limit (100kb) is far too small for a 5MB file that's been
// base64-inflated (~4/3 larger) plus JSON/row overhead; 20mb leaves comfortable headroom.
app.use(express.json({ limit: '20mb' }));

app.use('/api', projectsRouter);
app.use('/api', requestsRouter);
app.use('/api', environmentsRouter);
app.use('/api/proxy', proxyRouter);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
