const Service = require('node-windows').Service;
const path = require('path');

const svc = new Service({
  name: 'BongoFiscalBridge',
  script: path.join(__dirname, '..', 'dist', 'app.js'),
});

svc.on('uninstall', () => {
  console.log('BongoFiscalBridge service uninstalled.');
});

svc.uninstall();
