require('dotenv').config();
const http = require('http');
const { MongoClient, ObjectId } = require('mongodb');
const { v4: uuidv4 } = require('uuid');

// Kết nối MongoDB
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);
let db;

// Kết nối CSDL
async function connectDB() {
  await client.connect();
  db = client.db('mern_app');
  console.log('Connected to MongoDB');
}
connectDB();

// Hàm parse body JSON
function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
  });
}

// Hàm tạo apiKey
const generateApiKey = (userId, email) => `mern-${userId}-${email}-${uuidv4()}`;

// Tạo HTTP server
const server = http.createServer(async (req, res) => {
  const url = req.url;
  const method = req.method;

  // Set header JSON
  res.setHeader('Content-Type', 'application/json');

  try {
    // 1. Đăng ký người dùng
    if (url === '/users/register' && method === 'POST') {
      const { userName, email, password } = await parseRequestBody(req);

      if (!userName || !email || !password) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Missing required fields' }));
      }

      const existingUser = await db.collection('user').findOne({ email });
      if (existingUser) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Email already exists' }));
      }

      const result = await db.collection('user').insertOne({ userName, email, password });
      res.statusCode = 201;
      return res.end(JSON.stringify({ message: 'User registered successfully', userId: result.insertedId }));
    }

    // 2. Đăng nhập người dùng
    if (url === '/users/login' && method === 'POST') {
      const { email, password } = await parseRequestBody(req);

      if (!email || !password) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Missing required fields' }));
      }

      const user = await db.collection('user').findOne({ email, password });
      if (!user) {
        res.statusCode = 401;
        return res.end(JSON.stringify({ error: 'Invalid credentials' }));
      }

      const apiKey = generateApiKey(user._id, email);
      res.statusCode = 200;
      return res.end(JSON.stringify({ message: 'Login successful', apiKey }));
    }

    // 3. Tạo bài post
    if (url.startsWith('/posts') && method === 'POST') {
      const { apiKey, content } = await parseRequestBody(req);

      if (!apiKey || !content) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Missing required fields' }));
      }

      const [_, userId] = apiKey.split('-');
      const user = await db.collection('user').findOne({ _id: ObjectId(userId) });

      if (!user) {
        res.statusCode = 403;
        return res.end(JSON.stringify({ error: 'Invalid API key' }));
      }

      const createdAt = new Date();
      const result = await db.collection('post').insertOne({ userId, content, createdAt, updatedAt: createdAt });
      res.statusCode = 201;
      return res.end(JSON.stringify({ message: 'Post created successfully', postId: result.insertedId }));
    }

    // 4. Cập nhật bài post
    if (url.startsWith('/posts/') && method === 'PUT') {
      const id = url.split('/')[2];
      const { apiKey, content } = await parseRequestBody(req);

      if (!apiKey || !content) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Missing required fields' }));
      }

      const [_, userId] = apiKey.split('-');
      const user = await db.collection('user').findOne({ _id: ObjectId(userId) });

      if (!user) {
        res.statusCode = 403;
        return res.end(JSON.stringify({ error: 'Invalid API key' }));
      }

      const post = await db.collection('post').findOne({ _id: ObjectId(id) });
      if (!post) {
        res.statusCode = 404;
        return res.end(JSON.stringify({ error: 'Post not found' }));
      }

      const updatedAt = new Date();
      await db.collection('post').updateOne({ _id: ObjectId(id) }, { $set: { content, updatedAt } });
      res.statusCode = 200;
      return res.end(JSON.stringify({ message: 'Post updated successfully' }));
    }

    // Endpoint không tồn tại
    res.statusCode = 404;
    return res.end(JSON.stringify({ error: 'Endpoint not found' }));
  } catch (err) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: 'Internal server error', details: err.message }));
  }
});

// Khởi chạy server
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
