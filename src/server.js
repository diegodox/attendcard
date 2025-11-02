const fastify = require('fastify')({ logger: true });
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Security headers and rate limiting
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 100; // requests per window

// Rate limiting middleware
fastify.addHook('preHandler', async (request, reply) => {
  const clientIP = request.ip;
  const now = Date.now();
  
  // Clean old entries
  for (const [ip, data] of rateLimitMap.entries()) {
    if (now - data.resetTime > RATE_LIMIT_WINDOW) {
      rateLimitMap.delete(ip);
    }
  }
  
  // Check rate limit
  if (!rateLimitMap.has(clientIP)) {
    rateLimitMap.set(clientIP, { count: 0, resetTime: now });
  }
  
  const clientData = rateLimitMap.get(clientIP);
  
  // Reset if window expired
  if (now - clientData.resetTime > RATE_LIMIT_WINDOW) {
    clientData.count = 0;
    clientData.resetTime = now;
  }
  
  clientData.count++;
  
  if (clientData.count > RATE_LIMIT_MAX) {
    reply.status(429).send({ error: 'Too Many Requests' });
    return;
  }
});

// Security headers and no-cache
fastify.addHook('onSend', async (request, reply, payload) => {
  // Basic security headers
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-XSS-Protection', '1; mode=block');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('X-Download-Options', 'noopen');
  reply.header('X-Permitted-Cross-Domain-Policies', 'none');
  
  // No-cache headers
  reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  reply.header('Pragma', 'no-cache');
  reply.header('Expires', '0');
  
  // Content Security Policy
  reply.header('Content-Security-Policy', 
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "connect-src 'self' ws: wss:; " +
    "img-src 'self' data:; " +
    "font-src 'self'; " +
    "object-src 'none'; " +
    "base-uri 'self';"
  );
  
  // HSTS (only for HTTPS)
  if (request.protocol === 'https') {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
});

// WebSocket support
fastify.register(require('@fastify/websocket'));

// Static files with no-cache
fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, '../public'),
  prefix: '/',
  setHeaders(res /*, path, stat */) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
});

// Lightweight mobile page
fastify.get('/mobile', async (request, reply) => {
  const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AttendCard Mobile</title>
    <style>
        body { font-family: Arial; margin: 0; padding: 20px; background: #667eea; color: white; }
        .card { background: white; color: black; padding: 20px; margin: 10px 0; border-radius: 10px; }
        .btn { background: #667eea; color: white; border: none; padding: 10px 20px; border-radius: 5px; margin: 5px; }
    </style>
</head>
<body>
    <h1>AttendCard Mobile</h1>
    <div class="card">
        <h2>今日の出席</h2>
        <button class="btn" onclick="window.location.href='/'">フル版へ</button>
    </div>
    <script>
        console.log('Mobile page loaded');
    </script>
</body>
</html>`;
  
  reply.type('text/html').send(html);
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
  
  db.run(`CREATE TABLE IF NOT EXISTS member_defaults (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER,
    day_of_week INTEGER CHECK(day_of_week IN (1,2,3,4,5)),
    default_status TEXT CHECK(default_status IN ('attend', 'absent') OR default_status IS NULL),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(member_id) REFERENCES members(id),
    UNIQUE(member_id, day_of_week)
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
  
  // Ensure all existing members have default settings
  db.all(`
    SELECT DISTINCT m.id 
    FROM members m 
    LEFT JOIN member_defaults md ON m.id = md.member_id 
    WHERE md.member_id IS NULL
  `, (err, rows) => {
    if (!err && rows.length > 0) {
      const defaultStmt = db.prepare("INSERT INTO member_defaults (member_id, day_of_week, default_status) VALUES (?, ?, ?)");
      rows.forEach(row => {
        for (let day = 1; day <= 5; day++) {
          defaultStmt.run(row.id, day, null);
        }
      });
      defaultStmt.finalize();
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
// Get weekly attendance data (5 weekdays starting from today)
fastify.get('/api/attendance/week', async (request, reply) => {
  try {
    const weekData = await getWeekData();
    reply.send(weekData);
  } catch (error) {
    console.error('Error fetching week data:', error);
    reply.status(500).send({ error: 'Failed to fetch week data' });
  }
});

// Cache for optimized week data
let weekDataCache = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 1000; // 1 second cache

// Helper function to get week data with caching
async function getWeekData() {
  const now = Date.now();
  
  // Return cached data if still valid
  if (weekDataCache && (now - cacheTimestamp) < CACHE_DURATION) {
    return weekDataCache;
  }

  // Calculate dates once
  const dayNames = ['月', '火', '水', '木', '金'];
  const currentDay = new Date().getDay();
  const dates = calculateWeekDates(dayNames, currentDay);
  const dateStrings = dates.map(d => d.dateString);
  
  // Single optimized query to get all required data
  const allData = await new Promise((resolve, reject) => {
    const query = `
      SELECT 
        m.id as member_id,
        m.name as member_name,
        m.created_at as member_created_at,
        md.day_of_week,
        md.default_status,
        a.date as attendance_date,
        a.status as attendance_status
      FROM members m
      LEFT JOIN member_defaults md ON m.id = md.member_id
      LEFT JOIN attendance a ON m.id = a.member_id 
        AND a.date IN (${dateStrings.map(() => '?').join(',')})
      ORDER BY m.created_at ASC, md.day_of_week ASC
    `;
    
    db.all(query, dateStrings, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  // Process data efficiently
  const membersMap = new Map();
  const attendanceMap = new Map();
  const defaultsMap = new Map();

  // Single pass to organize all data
  for (const row of allData) {
    const memberId = row.member_id;
    
    // Build members map
    if (!membersMap.has(memberId)) {
      membersMap.set(memberId, {
        id: memberId,
        name: row.member_name,
        created_at: row.member_created_at
      });
    }
    
    // Build attendance map
    if (row.attendance_date) {
      const key = `${memberId}-${row.attendance_date}`;
      attendanceMap.set(key, row.attendance_status);
    }
    
    // Build defaults map
    if (row.day_of_week !== null) {
      const key = `${memberId}-${row.day_of_week}`;
      defaultsMap.set(key, row.default_status);
    }
  }

  const members = Array.from(membersMap.values());
  const weekData = {};

  // Build week data efficiently
  for (const { dayName, dateString } of dates) {
    const dayIndex = dayNames.indexOf(dayName) + 1;
    
    weekData[dayName] = {
      day: dayName,
      date: dateString,
      members: members.map(member => {
        const attendanceKey = `${member.id}-${dateString}`;
        const defaultKey = `${member.id}-${dayIndex}`;
        
        const currentStatus = attendanceMap.get(attendanceKey) || null;
        const defaultStatus = defaultsMap.get(defaultKey) || null;
        
        const appliedStatus = (currentStatus === null && defaultStatus !== undefined) ? defaultStatus : currentStatus;
        
        return {
          ...member,
          status: appliedStatus,
          originalStatus: currentStatus,
          defaultStatus: defaultStatus
        };
      })
    };
  }

  const result = { members, weekData };
  
  // Update cache
  weekDataCache = result;
  cacheTimestamp = now;
  
  return result;
}

// Helper function to calculate week dates
function calculateWeekDates(dayNames, currentDay) {
  const now = new Date();
  let currentDate = new Date(now);
  
  // If today is weekend, start from next Monday
  if (currentDay === 0) { // Sunday
    currentDate.setDate(now.getDate() + 1);
  } else if (currentDay === 6) { // Saturday
    currentDate.setDate(now.getDate() + 2);
  }
  
  const dates = [];
  let daysCollected = 0;
  
  while (daysCollected < 5) {
    const dayOfWeek = currentDate.getDay();
    
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      const dayName = dayNames[dayOfWeek - 1];
      dates.push({
        dayName,
        dateString: currentDate.toISOString().split('T')[0]
      });
      daysCollected++;
    }
    
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  return dates;
}

// Function to invalidate cache when data changes
function invalidateWeekDataCache() {
  weekDataCache = null;
  cacheTimestamp = 0;
}


// Update weekly attendance status
fastify.post('/api/attendance/weekly', async (request, reply) => {
  try {
    const { dayName, memberId, status } = request.body;
    
    if (!dayName || !memberId) {
      return reply.status(400).send({ error: 'dayName and memberId are required' });
    }
    
    // Convert day name to date - use the same logic as getWeekData()
    const dayNames = ['月', '火', '水', '木', '金'];
    
    // Validate day name
    if (!dayNames.includes(dayName)) {
      return reply.status(400).send({ error: 'Invalid day name' });
    }
    
    // Get 5 weekdays starting from today and find the target date
    const now = new Date();
    const currentDay = now.getDay(); // 0=日, 1=月, 2=火, 3=水, 4=木, 5=金, 6=土
    
    let currentDate = new Date(now);
    
    // If today is weekend, start from next Monday
    if (currentDay === 0) { // Sunday
      currentDate.setDate(now.getDate() + 1); // Next Monday
    } else if (currentDay === 6) { // Saturday
      currentDate.setDate(now.getDate() + 2); // Next Monday
    }
    
    // Collect weekdays in the same order as getWeekData()
    const dates = [];
    let daysCollected = 0;
    let targetDate = null;
    
    while (daysCollected < 5) {
      const dayOfWeek = currentDate.getDay();
      
      // Only process weekdays (Monday=1 to Friday=5)
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        const currentDayName = dayNames[dayOfWeek - 1];
        dates.push({
          date: new Date(currentDate),
          dayName: currentDayName
        });
        
        // Check if this is our target day
        if (currentDayName === dayName) {
          targetDate = new Date(currentDate);
        }
        
        daysCollected++;
      }
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    if (!targetDate) {
      return reply.status(400).send({ error: 'Could not calculate target date' });
    }
    const dateString = targetDate.toISOString().split('T')[0];
    
    if (status === null) {
      // Remove attendance record
      await new Promise((resolve, reject) => {
        db.run('DELETE FROM attendance WHERE member_id = ? AND date = ?', 
          [memberId, dateString], function(err) {
          if (err) reject(err);
          else resolve();
        });
      });
    } else {
      // Insert or update attendance record
      await new Promise((resolve, reject) => {
        db.run(`INSERT OR REPLACE INTO attendance (member_id, date, status) 
                VALUES (?, ?, ?)`, 
          [memberId, dateString, status], function(err) {
          if (err) reject(err);
          else resolve();
        });
      });
    }
    
    // Invalidate cache and broadcast update
    invalidateWeekDataCache();
    
    // Get fresh data and broadcast directly (faster than HTTP inject)
    try {
      const weekData = await getWeekData();
      broadcast({
        type: 'weekly_update',
        data: weekData
      });
    } catch (error) {
      console.error('Error broadcasting weekly update:', error);
    }
    
    reply.send({ success: true });
  } catch (error) {
    console.error('Error updating weekly attendance:', error);
    reply.status(500).send({ error: 'Failed to update attendance' });
  }
});

// Update member default status for a specific day
fastify.post('/api/member-defaults', async (request, reply) => {
  try {
    const { memberId, dayName, status } = request.body;
    
    if (!memberId || !dayName) {
      return reply.status(400).send({ error: 'memberId and dayName are required' });
    }
    
    // Convert day name to day index (1=月, 2=火, 3=水, 4=木, 5=金)
    const dayNames = ['月', '火', '水', '木', '金'];
    const dayIndex = dayNames.indexOf(dayName) + 1;
    
    if (dayIndex === 0) {
      return reply.status(400).send({ error: 'Invalid day name' });
    }
    
    if (status === "remove") {
      // Remove default setting
      await new Promise((resolve, reject) => {
        db.run('DELETE FROM member_defaults WHERE member_id = ? AND day_of_week = ?', 
          [memberId, dayIndex], function(err) {
          if (err) reject(err);
          else resolve();
        });
      });
    } else {
      // Insert or update default setting (status can be 'attend', 'absent', or 'pending' for null)
      const dbStatus = status === "pending" ? null : status;
      await new Promise((resolve, reject) => {
        db.run(`INSERT OR REPLACE INTO member_defaults (member_id, day_of_week, default_status) 
                VALUES (?, ?, ?)`, 
          [memberId, dayIndex, dbStatus], function(err) {
          if (err) reject(err);
          else resolve();
        });
      });
    }
    
    // Invalidate cache and broadcast update
    invalidateWeekDataCache();
    
    // Get fresh data and broadcast directly
    try {
      const weekData = await getWeekData();
      broadcast({
        type: 'weekly_update',
        data: weekData
      });
    } catch (error) {
      console.error('Error broadcasting member default update:', error);
    }
    
    reply.send({ success: true });
  } catch (error) {
    console.error('Error updating member default:', error);
    reply.status(500).send({ error: 'Failed to update member default' });
  }
});


fastify.get('/api/members', async (request, reply) => {
  return new Promise((resolve, reject) => {
    db.all("SELECT * FROM members ORDER BY created_at ASC", (err, rows) => {
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
  
  // Input validation
  if (!name || typeof name !== 'string') {
    return reply.status(400).send({ error: 'Name is required and must be a string' });
  }
  
  const trimmedName = name.trim();
  if (trimmedName.length === 0) {
    return reply.status(400).send({ error: 'Name cannot be empty' });
  }
  
  if (trimmedName.length > 50) {
    return reply.status(400).send({ error: 'Name cannot exceed 50 characters' });
  }
  
  // Sanitize name (remove dangerous characters)
  const sanitizedName = trimmedName.replace(/[<>"'&]/g, '');
  
  return new Promise((resolve, reject) => {
    db.run("INSERT INTO members (name) VALUES (?)", [sanitizedName], function(err) {
      if (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          reply.status(409).send({ error: 'Member name already exists' });
        } else {
          reply.status(500).send({ error: 'Database error' });
        }
        reject(err);
      } else {
        const memberId = this.lastID;
        
        // Add default settings for all weekdays (null = 未回答デフォルト)
        const defaultStmt = db.prepare("INSERT INTO member_defaults (member_id, day_of_week, default_status) VALUES (?, ?, ?)");
        for (let day = 1; day <= 5; day++) {
          defaultStmt.run(memberId, day, null);
        }
        defaultStmt.finalize();
        
        // Invalidate cache and broadcast update
        invalidateWeekDataCache();
        getWeekData().then(data => {
          broadcast({
            type: 'weekly_update',
            data: data
          });
        }).catch(err => {
          console.error('Error broadcasting update:', err);
        });
        
        resolve({ id: this.lastID, name: sanitizedName });
      }
    });
  });
});

fastify.delete('/api/members/:id', async (request, reply) => {
  const { id } = request.params;
  
  // Input validation
  const memberId = parseInt(id, 10);
  if (isNaN(memberId) || memberId <= 0) {
    return reply.status(400).send({ error: 'Invalid member ID' });
  }
  
  return new Promise((resolve, reject) => {
    // Delete attendance records first (foreign key constraint)
    db.run("DELETE FROM attendance WHERE member_id = ?", [memberId], (err) => {
      if (err) {
        console.error('Error deleting attendance records:', err);
        reply.status(500).send({ error: 'Database error' });
        reject(err);
        return;
      }
      
      // Then delete the member
      db.run("DELETE FROM members WHERE id = ?", [memberId], function(err) {
        if (err) {
          console.error('Error deleting member:', err);
          reply.status(500).send({ error: 'Database error' });
          reject(err);
        } else {
          if (this.changes === 0) {
            reply.status(404).send({ error: 'Member not found' });
            resolve({ success: false });
            return;
          }
          
          // Invalidate cache and broadcast update
          invalidateWeekDataCache();
          getWeekData().then(data => {
            broadcast({
              type: 'weekly_update',
              data: data
            });
          }).catch(err => {
            console.error('Error broadcasting update:', err);
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
        
        // Invalidate cache and broadcast weekly update to all clients
        invalidateWeekDataCache();
        getWeekData().then(data => {
          broadcast({
            type: 'weekly_update',
            data: data
          });
        });
        
        resolve({ success: true, deletedRecords: this.changes, date: today });
      }
    });
  });
});

// Auto-reset function (Japan Standard Time)
function scheduleAutoReset() {
  // Get current Japan time
  const now = new Date();
  const japanNow = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Tokyo"}));
  
  // Set next reset time to 13:00 JST
  const nextReset = new Date(japanNow);
  nextReset.setHours(13, 0, 0, 0);
  
  // If 13:00 has already passed today, schedule for tomorrow
  if (japanNow >= nextReset) {
    nextReset.setDate(nextReset.getDate() + 1);
  }
  
  // Convert back to local system time for setTimeout
  const systemNextReset = new Date(nextReset.toLocaleString("en-US", {timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone}));
  const timeUntilReset = systemNextReset.getTime() - now.getTime();
  
  console.log(`Next auto-reset scheduled for: ${nextReset.toLocaleString('ja-JP', {timeZone: 'Asia/Tokyo'})} JST`);
  console.log(`Time until reset: ${Math.floor(timeUntilReset / 1000 / 60 / 60)}h ${Math.floor((timeUntilReset / 1000 / 60) % 60)}m`);
  
  setTimeout(async () => {
    console.log('Executing automatic reset at 13:00 JST');
    
    const today = new Date().toISOString().split('T')[0];
    db.run("DELETE FROM attendance WHERE date = ?", [today], function(err) {
      if (err) {
        console.error('Auto-reset failed:', err);
      } else {
        console.log(`Auto-reset completed: deleted ${this.changes} records for ${today}`);
        
        // Invalidate cache and broadcast weekly update to all clients
        invalidateWeekDataCache();
        getWeekData().then(data => {
          broadcast({
            type: 'weekly_update',
            data: data
          });
          broadcast({
            type: 'auto_reset',
            message: '13時になりました。出席状況がリセットされました。'
          });
        }).catch(err => {
          console.error('Error broadcasting auto-reset update:', err);
        });
      }
    });
    
    // Schedule next reset
    scheduleAutoReset();
  }, timeUntilReset);
}

// API endpoint to get next reset time (Japan Standard Time)
fastify.get('/api/next-reset', async (request, reply) => {
  // Get current Japan time
  const now = new Date();
  const japanNow = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Tokyo"}));
  
  // Set next reset time to 13:00 JST
  const nextReset = new Date(japanNow);
  nextReset.setHours(13, 0, 0, 0);
  
  // If 13:00 has already passed today, schedule for tomorrow
  if (japanNow >= nextReset) {
    nextReset.setDate(nextReset.getDate() + 1);
  }
  
  // Convert back to system time for client
  const systemNextReset = new Date(nextReset.toLocaleString("en-US", {timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone}));
  
  return {
    nextReset: systemNextReset.toISOString(),
    nextResetJST: nextReset.toLocaleString('ja-JP', {timeZone: 'Asia/Tokyo'}),
    timeUntilReset: systemNextReset.getTime() - now.getTime()
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