process.env.NODE_ENV = process.env.NODE_ENV || 'production';
process.env.XGPY_SERVE_FRONTEND = 'true';

require('./env');

const path = require('path');
const express = require('express');
const { app, startServer } = require('./index');

const frontendDist = path.join(__dirname, '..', 'exe-assets', 'frontend-dist');

app.use(express.static(frontendDist));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(frontendDist, 'index.html'));
});

startServer().catch((error) => {
  console.error('Failed to start XGPY exe server:', error);
  process.exit(1);
});
