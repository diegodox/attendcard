const fastify = require('fastify')({ logger: true });
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// WebSocket support
fastify.register(require('@fastify/websocket'));

// Static files
fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, '../public'),
  prefix: '/',
});

// Database setup
const dbPath = path.join(__dirname, '../data/attendance.db');
const db = new sqlite3.Database(dbPath);

// Initialize database
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER,
    date DATE,
    status TEXT CHECK(status IN ('attend', 'absent')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(member_id) REFERENCES members(id),
    UNIQUE(member_id, date)
  )`);
  
  // Insert default members if none exist
  db.get("SELECT COUNT(*) as count FROM members", (err, row) => {
    if (row.count === 0) {
      const defaultMembers = ['田中', '佐藤', '鈴木', '高橋', '渡辺'];
      const stmt = db.prepare("INSERT INTO members (name) VALUES (?)");
      defaultMembers.forEach(name => stmt.run(name));
      stmt.finalize();
    }
  });
});

// WebSocket connections
const connections = new Set();

// WebSocket endpoint
fastify.register(async function (fastify) {
  fastify.get('/ws', { websocket: true }, (connection, req) => {
    console.log('New WebSocket connection established');
    connections.add(connection.socket);
    
    connection.socket.on('close', () => {
      console.log('WebSocket connection closed');
      connections.delete(connection.socket);
    });
    
    connection.socket.on('error', (error) => {
      console.log('WebSocket error:', error);
      connections.delete(connection.socket);
    });
  });
});

// Broadcast to all connected clients
function broadcast(data) {
  const message = JSON.stringify(data);
  console.log(`Broadcasting to ${connections.size} clients:`, data);
  connections.forEach(connection => {
    console.log('Connection readyState:', connection.readyState);
    if (connection.readyState === 1) { // WebSocket.OPEN = 1
      console.log('Sending message to client');
      connection.send(message);
    } else {
      console.log('Connection not open, removing from set');
      connections.delete(connection);
    }
  });
}

// API Routes
fastify.get('/api/attendance/today', async (request, reply) => {
  const today = new Date().toISOString().split('T')[0];
  
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT m.id, m.name, a.status
      FROM members m
      LEFT JOIN attendance a ON m.id = a.member_id AND a.date = ?
      ORDER BY m.name
    `, [today], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        const members = rows.map(row => ({
          id: row.id,
          name: row.name,
          status: row.status || null
        }));
        
        const attendCount = members.filter(m => m.status === 'attend').length;
        const absentCount = members.filter(m => m.status === 'absent').length;
        const totalCount = members.length;
        
        resolve({
          date: today,
          members,
          summary: {
            attend: attendCount,
            absent: absentCount,
            total: totalCount,
            pending: totalCount - attendCount - absentCount
          }
        });
      }
    });
  });
});

fastify.post('/api/attendance', async (request, reply) => {
  const { memberId, status } = request.body;
  const today = new Date().toISOString().split('T')[0];
  
  return new Promise((resolve, reject) => {
    db.run(`
      INSERT OR REPLACE INTO attendance (member_id, date, status)
      VALUES (?, ?, ?)
    `, [memberId, today, status], function(err) {
      if (err) {
        reject(err);
      } else {
        // Broadcast update to all clients
        fastify.inject({
          method: 'GET',
          url: '/api/attendance/today'
        }).then(response => {
          broadcast({
            type: 'attendance_update',
            data: JSON.parse(response.payload)
          });
        });
        
        resolve({ success: true });
      }
    });
  });
});

fastify.get('/api/members', async (request, reply) => {
  return new Promise((resolve, reject) => {
    db.all("SELECT * FROM members ORDER BY name", (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
});

fastify.post('/api/members', async (request, reply) => {
  const { name } = request.body;
  
  return new Promise((resolve, reject) => {
    db.run("INSERT INTO members (name) VALUES (?)", [name], function(err) {
      if (err) {
        reject(err);
      } else {
        // Broadcast update to all clients
        fastify.inject({
          method: 'GET',
          url: '/api/attendance/today'
        }).then(response => {
          broadcast({
            type: 'attendance_update',
            data: JSON.parse(response.payload)
          });
        });
        
        resolve({ id: this.lastID, name });
      }
    });
  });
});

fastify.delete('/api/members/:id', async (request, reply) => {
  const { id } = request.params;
  
  return new Promise((resolve, reject) => {
    // Delete attendance records first (foreign key constraint)
    db.run("DELETE FROM attendance WHERE member_id = ?", [id], (err) => {
      if (err) {
        reject(err);
        return;
      }
      
      // Then delete the member
      db.run("DELETE FROM members WHERE id = ?", [id], function(err) {
        if (err) {
          reject(err);
        } else {
          // Broadcast update to all clients
          fastify.inject({
            method: 'GET',
            url: '/api/attendance/today'
          }).then(response => {
            broadcast({
              type: 'attendance_update',
              data: JSON.parse(response.payload)
            });
          });
          
          resolve({ success: true, deletedRows: this.changes });
        }
      });
    });
  });
});

fastify.post('/api/attendance/reset', async (request, reply) => {
  const today = new Date().toISOString().split('T')[0];
  
  return new Promise((resolve, reject) => {
    db.run("DELETE FROM attendance WHERE date = ?", [today], function(err) {
      if (err) {
        reject(err);
      } else {
        console.log(`Reset attendance for ${today}, deleted ${this.changes} records`);
        
        // Broadcast update to all clients
        fastify.inject({
          method: 'GET',
          url: '/api/attendance/today'
        }).then(response => {
          broadcast({
            type: 'attendance_update',
            data: JSON.parse(response.payload)
          });
        });
        
        resolve({ success: true, deletedRecords: this.changes, date: today });
      }
    });
  });
});

// Auto-reset function
function scheduleAutoReset() {
  const now = new Date();
  const today13 = new Date(now);
  today13.setHours(13, 0, 0, 0);
  
  // If 13:00 has already passed today, schedule for tomorrow
  if (now >= today13) {
    today13.setDate(today13.getDate() + 1);
  }
  
  const timeUntilReset = today13.getTime() - now.getTime();
  
  console.log(`Next auto-reset scheduled for: ${today13.toLocaleString('ja-JP')}`);
  console.log(`Time until reset: ${Math.floor(timeUntilReset / 1000 / 60 / 60)}h ${Math.floor((timeUntilReset / 1000 / 60) % 60)}m`);
  
  setTimeout(async () => {
    console.log('Executing automatic reset at 13:00');
    
    const today = new Date().toISOString().split('T')[0];
    db.run("DELETE FROM attendance WHERE date = ?", [today], function(err) {
      if (err) {
        console.error('Auto-reset failed:', err);
      } else {
        console.log(`Auto-reset completed: deleted ${this.changes} records for ${today}`);
        
        // Broadcast update to all clients
        fastify.inject({
          method: 'GET',
          url: '/api/attendance/today'
        }).then(response => {
          broadcast({
            type: 'attendance_update',
            data: JSON.parse(response.payload)
          });
          broadcast({
            type: 'auto_reset',
            message: '13時になりました。出席状況がリセットされました。'
          });
        });
      }
    });
    
    // Schedule next reset
    scheduleAutoReset();
  }, timeUntilReset);
}

// API endpoint to get next reset time
fastify.get('/api/next-reset', async (request, reply) => {
  const now = new Date();
  const today13 = new Date(now);
  today13.setHours(13, 0, 0, 0);
  
  // If 13:00 has already passed today, schedule for tomorrow
  if (now >= today13) {
    today13.setDate(today13.getDate() + 1);
  }
  
  return {
    nextReset: today13.toISOString(),
    timeUntilReset: today13.getTime() - now.getTime()
  };
});

// Start server
const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('AttendCard server running on port 3000');
    
    // Schedule auto-reset
    scheduleAutoReset();
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();