const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const envPath = path.join(__dirname, '..', '.env');
const envExamplePath = path.join(__dirname, '..', '.env.example');

if (fs.existsSync(envPath)) {
  console.log('.env already exists — skipping generation.');
  process.exit(0);
}

let content = '';
if (fs.existsSync(envExamplePath)) {
  content = fs.readFileSync(envExamplePath, 'utf-8');
} else {
  content = [
    'PORT=9000',
    'ECR_BRIDGE_BON_PATH=C:/ECRBridge/Bon/',
    'ECR_BRIDGE_BON_OK_PATH=C:/ECRBridge/BonOK/',
    'ECR_BRIDGE_BON_ERR_PATH=C:/ECRBridge/BonErr/',
    'RESPONSE_TIMEOUT=15000',
    'BRIDGE_MODE=live',
    'LOG_LEVEL=info',
    'AGENT_ENABLED=true',
    'HEARTBEAT_INTERVAL=30000',
    'LOG_BATCH_INTERVAL=60000',
    'COMMAND_POLL_INTERVAL=10000',
  ].join('\n');
}

const clientId = uuidv4();
if (/^CLIENT_ID=/m.test(content)) {
  content = content.replace(/^CLIENT_ID=.*$/m, `CLIENT_ID=${clientId}`);
} else {
  content += `\nCLIENT_ID=${clientId}`;
}

fs.writeFileSync(envPath, content, 'utf-8');
console.log(`.env created with CLIENT_ID=${clientId}`);
