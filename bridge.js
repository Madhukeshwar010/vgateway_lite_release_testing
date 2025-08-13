const WebSocket = require('ws');
const mqtt = require('mqtt');
const fs = require('fs');

const wss = new WebSocket.Server({ port: 8080 });

console.log('✅ WebSocket bridge running on ws://localhost:8080');

wss.on('connection', (ws) => {
  let mqttClient = null;

  ws.on('message', (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (err) {
      ws.send(JSON.stringify({ type: 'status', message: '❌ Invalid JSON received' }));
      return;
    }

    if (data.type === 'config') {
      if (mqttClient) {
        mqttClient.end(true);
        mqttClient = null;
      }

      const { broker, port, useSSL, ca, cert, key } = data;

      const options = {
        reconnectPeriod: 1000,
        protocolVersion: 4,
        rejectUnauthorized: false
      };

      if (useSSL) {
        if (ca) options.ca = Buffer.from(ca);
        if (cert) options.cert = Buffer.from(cert);
        if (key) options.key = Buffer.from(key);
      }

      const protocol = useSSL ? 'mqtts' : 'mqtt';
      const mqttUrl = `${protocol}://${broker}:${port}`;

      mqttClient = mqtt.connect(mqttUrl, options);

      mqttClient.on('connect', () => {
        ws.send(JSON.stringify({ type: 'status', message: '✅ MQTT connected' }));

        // Automatically subscribe to GatewayReply topic
      });

      mqttClient.on('error', (err) => {
        ws.send(JSON.stringify({ type: 'status', message: '❌ MQTT error: ' + err.message }));
      });

      mqttClient.on('message', (topic, msg) => {
        const message = msg.toString();

        // Log nicely if it's a reply topic
        if (topic.includes('GatewayReply')) {
          console.log(`📥 🔁 Reply Received on: ${topic}`);
          console.log(`🧾 Message:\n${message}`);
        } else {
          console.log(`📥 MQTT Message | Topic: ${topic} | Message: ${message}`);
        }

        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'message',
            topic: topic,
            message: message
          }));
        }
      });

      mqttClient.on('close', () => {
        ws.send(JSON.stringify({ type: 'status', message: '❌ MQTT disconnected' }));
      });

    } else if (data.type === 'subscribe') {
      if (mqttClient && data.topic) {
        // Allow both single topic (string) and multiple topics (array)
        let topics = Array.isArray(data.topic) ? data.topic : [data.topic];

        mqttClient.subscribe(topics, (err) => {
          if (err) {
            ws.send(JSON.stringify({ type: 'status', message: '❌ Subscribe error: ' + err.message }));
          } else {
            ws.send(JSON.stringify({ type: 'status', message: `🔔 Subscribed to ${topics.join(', ')}` }));
          }
        });
      }
    } else if (data.type === 'publish') {
      if (mqttClient && data.topic && data.message) {
        mqttClient.publish(data.topic, data.message, (err) => {
          if (err) {
            ws.send(JSON.stringify({ type: 'status', message: '❌ Publish error: ' + err.message }));
          } else {
            ws.send(JSON.stringify({ type: 'status', message: `📤 Published to ${data.topic}` }));
          }
        });
      }
    } else {
      ws.send(JSON.stringify({ type: 'status', message: '❓ Unknown message type' }));
    }
  });

  ws.on('close', () => {
    if (mqttClient) {
      mqttClient.end(true);
      mqttClient = null;
    }
  });
});
