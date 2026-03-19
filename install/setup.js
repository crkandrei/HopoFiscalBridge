const Service = require('node-windows').Service;
const path = require('path');

const svc = new Service({
  name: 'BongoFiscalBridge',
  description: 'Bongo Fiscal Bridge — ECR printer integration service',
  script: path.join(__dirname, '..', 'dist', 'app.js'),
  env: { name: 'NODE_ENV', value: 'production' },
});

svc.on('install', () => {
  console.log('Service installed. Starting...');
  svc.start();
});

svc.on('start', () => {
  console.log('BongoFiscalBridge service started successfully.');
});

svc.on('error', (err) => {
  console.error('Service error:', err);
});

svc.install();
