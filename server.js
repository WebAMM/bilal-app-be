// server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const awsIot = require('aws-iot-device-sdk');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
const tmpDir = path.join(__dirname, 'tmp');

if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir);
}

fs.writeFileSync(path.join(tmpDir, 'private.pem.key'), process.env.privateKeyEnv.replace(/\\n/g, '\n'));
fs.writeFileSync(path.join(tmpDir, 'certificate.pem.crt'), process.env.certificateEnv.replace(/\\n/g, '\n'));
fs.writeFileSync(path.join(tmpDir, 'AmazonRootCA1.pem'), process.env.rootCAEnv.replace(/\\n/g, '\n'));

let device = awsIot.device({
    keyPath: path.join(tmpDir, 'private.pem.key'),
    certPath: path.join(tmpDir, 'certificate.pem.crt'),
    caPath: path.join(tmpDir, 'AmazonRootCA1.pem'),
    clientId: process.env.MQTT_CLIENT_ID,
    host: process.env.AWS_IOT_HOST
});


device.on('connect', () => {
    console.log('✅ Connected to AWS IoT');
});

device.on('error', error => {
    console.error('❌ MQTT connection error:', error);
});


app.post('/', (req, res) => {
    res.status(200).json({
        message: 'Initial Route Runing'
    })
})


// REST endpoint to publish MQTT message
app.post('/mqtt/publish', (req, res) => {
    const body = req.body;
    const { topic, msgKey } = req.body;
    console.log('Publishing message:', { topic, msgKey });
    // if (!topic ) {
    //     return res.status(400).json({ error: 'Topic and message are required' });
    // }
    device.publish(topic, JSON.stringify(body), {}, err => {
        if (err) {
            console.error('Publish failed:', err);
            return res.status(500).json({ error: 'Publish failed' });
        }
        res.json({ success: true });
    });
});

// WebSocket: handle subscribe requests and emit topic data
const clients = new Map();

wss.on('connection', ws => {
    clients.set(ws, new Set());

    ws.on('message', msg => {
        console.log('Received message:', msg);
        try {
            const { action, topic } = JSON.parse(msg);
            if (action === 'subscribe' && topic) {
                if (!clients.get(ws).has(topic)) {
                    clients.get(ws).add(topic);
                    device.subscribe(topic);
                }
            }
        } catch (e) {
            ws.send(JSON.stringify({ error: 'Invalid JSON' }));
        }
    });

    ws.on('close', () => {
        const topics = clients.get(ws) || [];
        topics.forEach(topic => {
            // Optional: Unsubscribe logic
        });
        clients.delete(ws);
    });
});

device.on('message', (topic, payload) => {
    for (const [ws, topics] of clients.entries()) {
        if (topics.has(topic) && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ topic, message: payload.toString() }));
        }
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
