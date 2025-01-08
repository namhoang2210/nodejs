require('dotenv').config();
const http = require('http');
const { MongoClient, ObjectId } = require('mongodb');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt'); // Thư viện mã hóa mật khẩu

// Kết nối MongoDB
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);
let db;

async function connectDB() {
  await client.connect();
  db = client.db('mern_app');
  console.log('Kết nối tới MongoDB thành công');
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

// Hàm tạo API Key (lưu randomString vào cơ sở dữ liệu)
const generateApiKey = async (userId, email) => {
  const randomString = uuidv4();
  const apiKey = `mern-$${userId}$-$${email}$-$${randomString}$`;
  
  // Lưu randomString vào cơ sở dữ liệu
  await db.collection('user').updateOne(
    { _id: new ObjectId(userId) },
    { $set: { randomString } }
  );

  return apiKey;
};

// Hàm kiểm tra API Key
const validateApiKey = async (apiKey) => {
  // Kiểm tra xem API Key có bắt đầu bằng "mern-" không
  if (!apiKey.startsWith('mern-') || !apiKey.includes('$')) {
    return false;
  }

  // Loại bỏ tiền tố "mern-"
  const rawKey = apiKey.replace('mern-', '');

  // Tách các phần dựa trên dấu `$`
  const parts = rawKey.split('$');

  const userId = parts[1];
  const email = parts[3];
  const randomString = parts[5];

  console.log(userId, email, randomString)

  // Kiểm tra `userId` có phải là ObjectId hợp lệ không
  if (!ObjectId.isValid(userId)) {
    return false;
  }

  try {
    // Truy vấn cơ sở dữ liệu để xác thực
    const user = await db.collection('user').findOne({
      _id: new ObjectId(userId), // Chuyển userId thành ObjectId
      email: email,
      randomString: randomString,
    });

    // Trả về thông tin người dùng nếu hợp lệ, ngược lại trả về false
    return user ? user : false;
  } catch (error) {
    console.error('Error validating API Key:', error.message);
    return false;
  }
};


// HTTP server
const server = http.createServer(async (req, res) => {
  const url = req.url;
  const method = req.method;

  res.setHeader('Content-Type', 'application/json');

  try {
    // 1. Đăng ký người dùng
    if (url === '/users/register' && method === 'POST') {
      const { userName, email, password } = await parseRequestBody(req);

      if (!userName || !email || !password) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Thiếu thông tin bắt buộc' }));
      }

      const existingUser = await db.collection('user').findOne({ email });
      if (existingUser) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Email đã tồn tại' }));
      }

      // Mã hóa mật khẩu
      const hashedPassword = await bcrypt.hash(password, 10);

      const result = await db.collection('user').insertOne({ userName, email, password: hashedPassword });
      res.statusCode = 201;
      return res.end(JSON.stringify({ message: 'Đăng ký thành công', userId: result.insertedId }));
    }

    // 2. Đăng nhập người dùng
    if (url === '/users/login' && method === 'POST') {
      const { email, password } = await parseRequestBody(req);

      if (!email || !password) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Thiếu thông tin bắt buộc' }));
      }

      const user = await db.collection('user').findOne({ email });
      if (!user) {
        res.statusCode = 401;
        return res.end(JSON.stringify({ error: 'Email hoặc mật khẩu không đúng' }));
      }

      // Kiểm tra mật khẩu
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        res.statusCode = 401;
        return res.end(JSON.stringify({ error: 'Email hoặc mật khẩu không đúng' }));
      }

      const apiKey = await generateApiKey(user._id, email);
      res.statusCode = 200;
      return res.end(JSON.stringify({ message: 'Đăng nhập thành công', apiKey }));
    }

    // 3. Tạo bài post
    if (url.startsWith('/posts') && method === 'POST') {
      const { apiKey, content } = await parseRequestBody(req);

      if (!apiKey) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Thiếu API Key' }));
      }

      if (!content) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Thiếu nội dung bài viết' }));
      }

      const [_, userId] = apiKey.split('-');

      const user = await validateApiKey(apiKey);
      if (!user) {
        res.statusCode = 403;
        return res.end(JSON.stringify({ error: 'API Key không hợp lệ' }));
      }

      const createdAt = new Date();
      const result = await db.collection('post').insertOne({ userId, content, createdAt, updatedAt: createdAt });
      res.statusCode = 201;
      return res.end(JSON.stringify({ message: 'Tạo bài post thành công', postId: result.insertedId }));
    }

    // 4. Cập nhật bài post
    if (url.startsWith('/posts/') && method === 'PUT') {
      const id = url.split('/')[2];
      const { apiKey, content } = await parseRequestBody(req);

      if (!apiKey) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Thiếu API Key' }));
      }

      if (!content) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Thiếu nội dung bài viết' }));
      }

      const user = await validateApiKey(apiKey);

      if (!user) {
        res.statusCode = 403;
        return res.end(JSON.stringify({ error: 'API Key không hợp lệ' }));
      }

      const post = await db.collection('post').findOne({ _id: new ObjectId(id) });
      if (!post) {
        res.statusCode = 404;
        return res.end(JSON.stringify({ error: 'Bài post không tồn tại' }));
      }

      const updatedAt = new Date();
      await db.collection('post').updateOne({ _id: new ObjectId(id) }, { $set: { content, updatedAt } });
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
