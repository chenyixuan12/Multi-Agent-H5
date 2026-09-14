import express from 'express';
const app = express();
import travelRouter from './routes/travel.js';
import 'dotenv/config';
import cors from 'cors';

// 配置 CORS
app.use(cors());

//指定监听端口
const port = process.env.PORT || 3300;
//中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
//创建心跳接口验证服务有没有启动成功
app.post('/api/heartbeat', (req, res) => {
    console.log(req.body);
    res.json({
       message: 'Server is running',
       timestamp:new Date().toISOString()
  })
});
//创建一个中间件
app.use('/api/travel',travelRouter)

app.listen(port, () => {
  console.log(`Server is running on port :http://localhost:${port}`);
});