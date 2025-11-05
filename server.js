const express = require('express');
const multer = require('multer');
const archiver = require('archiver');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const config = require('./config.json');

const app = express();

// 确保必要的目录存在
async function ensureDirectories() {
  await fs.mkdir(config.storagePath, { recursive: true });
  await fs.mkdir(config.tempPath, { recursive: true });
  await fs.mkdir(path.join(__dirname, 'public'), { recursive: true });
}

// 配置文件上传
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    await fs.mkdir(config.tempPath, { recursive: true });
    cb(null, config.tempPath);
  },
  filename: (req, file, cb) => {
    // 修复文件名编码问题
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, `${Date.now()}-${originalName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxFileSize }
});

// 静态文件服务
app.use(express.static('public'));
app.use(express.json());

// API: 获取文件列表
app.get('/api/files', async (req, res) => {
  try {
    const relativePath = req.query.path || '';
    const fullPath = path.join(config.storagePath, relativePath);

    // 安全检查：防止路径遍历攻击
    const resolvedPath = path.resolve(fullPath);
    const resolvedStorage = path.resolve(config.storagePath);
    if (!resolvedPath.startsWith(resolvedStorage)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const items = await fs.readdir(fullPath, { withFileTypes: true });
    const files = await Promise.all(items.map(async item => {
      const itemPath = path.join(fullPath, item.name);
      const stats = await fs.stat(itemPath);
      return {
        name: item.name,
        type: item.isDirectory() ? 'directory' : 'file',
        size: stats.size,
        modified: stats.mtime,
        path: path.join(relativePath, item.name)
      };
    }));

    res.json({ files });
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.json({ files: [] });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// API: 分片上传
app.post('/api/upload-chunk', upload.single('chunk'), async (req, res) => {
  try {
    const { chunkIndex, totalChunks, fileName, relativePath = '' } = req.body;
    const uploadId = req.body.uploadId || `${fileName}-${Date.now()}`;

    // 创建上传会话目录
    const sessionDir = path.join(config.tempPath, uploadId);
    await fs.mkdir(sessionDir, { recursive: true });

    // 保存分片
    const chunkPath = path.join(sessionDir, `chunk-${chunkIndex}`);
    await fs.rename(req.file.path, chunkPath);

    // 记录上传进度
    const progressFile = path.join(sessionDir, 'progress.json');
    let progress = { chunks: [], totalChunks: parseInt(totalChunks), fileName, relativePath };

    try {
      const data = await fs.readFile(progressFile, 'utf-8');
      progress = JSON.parse(data);
    } catch (e) {
      // 进度文件不存在，使用新的
    }

    progress.chunks.push(parseInt(chunkIndex));
    await fs.writeFile(progressFile, JSON.stringify(progress));

    res.json({
      uploadId,
      received: progress.chunks.length,
      total: progress.totalChunks
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: 合并分片
app.post('/api/merge-chunks', async (req, res) => {
  try {
    const { uploadId } = req.body;
    const sessionDir = path.join(config.tempPath, uploadId);

    // 读取进度信息
    const progressFile = path.join(sessionDir, 'progress.json');
    const progressData = await fs.readFile(progressFile, 'utf-8');
    const progress = JSON.parse(progressData);

    // 确认所有分片都已上传
    if (progress.chunks.length !== progress.totalChunks) {
      return res.status(400).json({
        error: 'Not all chunks uploaded',
        received: progress.chunks.length,
        expected: progress.totalChunks
      });
    }

    // 创建目标目录
    const targetDir = path.join(config.storagePath, progress.relativePath);
    await fs.mkdir(targetDir, { recursive: true });

    // 合并分片
    const targetPath = path.join(targetDir, progress.fileName);
    const writeStream = fsSync.createWriteStream(targetPath);

    for (let i = 0; i < progress.totalChunks; i++) {
      const chunkPath = path.join(sessionDir, `chunk-${i}`);
      const chunkData = await fs.readFile(chunkPath);
      writeStream.write(chunkData);
    }

    writeStream.end();

    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    // 清理临时文件
    await fs.rm(sessionDir, { recursive: true, force: true });

    res.json({ success: true, path: path.join(progress.relativePath, progress.fileName) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: 简单上传（小文件）
app.post('/api/upload', upload.array('files'), async (req, res) => {
  try {
    const relativePath = req.body.relativePath || '';
    const targetDir = path.join(config.storagePath, relativePath);
    await fs.mkdir(targetDir, { recursive: true });

    const uploadedFiles = [];
    for (const file of req.files) {
      // 修复文件名编码问题
      const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const targetPath = path.join(targetDir, originalName);
      await fs.rename(file.path, targetPath);
      uploadedFiles.push({
        name: originalName,
        path: path.join(relativePath, originalName)
      });
    }

    res.json({ success: true, files: uploadedFiles });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: 下载单个文件或文件夹
app.get('/api/download/:path(*)', async (req, res) => {
  try {
    const filePath = path.join(config.storagePath, req.params.path);

    // 安全检查
    const resolvedPath = path.resolve(filePath);
    const resolvedStorage = path.resolve(config.storagePath);
    if (!resolvedPath.startsWith(resolvedStorage)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const stats = await fs.stat(filePath);

    if (stats.isFile()) {
      // 直接下载文件
      res.download(filePath);
    } else if (stats.isDirectory()) {
      // 文件夹打包成zip下载
      const folderName = path.basename(filePath);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${folderName}.zip"`);

      const archive = archiver('zip', { zlib: { level: 9 } });

      archive.on('error', (err) => {
        res.status(500).json({ error: err.message });
      });

      archive.pipe(res);
      archive.directory(filePath, false);
      await archive.finalize();
    } else {
      return res.status(400).json({ error: 'Invalid file type' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: 批量下载（打包成zip）
app.post('/api/download-multiple', express.json(), async (req, res) => {
  try {
    const { files } = req.body;

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'No files specified' });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="files-${Date.now()}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('error', (err) => {
      res.status(500).json({ error: err.message });
    });

    archive.pipe(res);

    for (const file of files) {
      const filePath = path.join(config.storagePath, file);

      // 安全检查
      const resolvedPath = path.resolve(filePath);
      const resolvedStorage = path.resolve(config.storagePath);
      if (!resolvedPath.startsWith(resolvedStorage)) {
        continue;
      }

      try {
        const stats = await fs.stat(filePath);
        if (stats.isFile()) {
          // 添加单个文件
          archive.file(filePath, { name: path.basename(file) });
        } else if (stats.isDirectory()) {
          // 添加整个文件夹（保留目录结构）
          archive.directory(filePath, path.basename(file));
        }
      } catch (e) {
        console.error(`Failed to add ${file} to archive:`, e);
      }
    }

    await archive.finalize();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: 删除文件或文件夹
app.delete('/api/delete', express.json(), async (req, res) => {
  try {
    const { paths } = req.body;

    if (!paths || !Array.isArray(paths) || paths.length === 0) {
      return res.status(400).json({ error: 'No paths specified' });
    }

    const deleted = [];
    for (const relativePath of paths) {
      const fullPath = path.join(config.storagePath, relativePath);

      // 安全检查
      const resolvedPath = path.resolve(fullPath);
      const resolvedStorage = path.resolve(config.storagePath);
      if (!resolvedPath.startsWith(resolvedStorage)) {
        continue;
      }

      try {
        await fs.rm(fullPath, { recursive: true, force: true });
        deleted.push(relativePath);
      } catch (e) {
        console.error(`Failed to delete ${relativePath}:`, e);
      }
    }

    res.json({ success: true, deleted });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: 创建文件夹
app.post('/api/create-folder', express.json(), async (req, res) => {
  try {
    const { folderName, relativePath = '' } = req.body;

    if (!folderName || typeof folderName !== 'string') {
      return res.status(400).json({ error: 'Invalid folder name' });
    }

    // 检查文件夹名称是否包含非法字符
    if (/[<>:"|?*\\\/]/.test(folderName)) {
      return res.status(400).json({ error: 'Folder name contains invalid characters' });
    }

    const targetPath = path.join(config.storagePath, relativePath, folderName);

    // 安全检查
    const resolvedPath = path.resolve(targetPath);
    const resolvedStorage = path.resolve(config.storagePath);
    if (!resolvedPath.startsWith(resolvedStorage)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // 检查文件夹是否已存在
    try {
      await fs.access(targetPath);
      return res.status(400).json({ error: 'Folder already exists' });
    } catch (e) {
      // 文件夹不存在，继续创建
    }

    // 创建文件夹
    await fs.mkdir(targetPath, { recursive: true });

    res.json({
      success: true,
      path: path.join(relativePath, folderName)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取本机局域网IP地址
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // 跳过内部地址和非IPv4地址
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }

  return addresses;
}

// 启动服务器
ensureDirectories().then(() => {
  const host = config.host || '0.0.0.0';

  app.listen(config.port, host, () => {
    console.log('\n✓ 文件同步系统启动成功！\n');
    console.log(`存储路径: ${path.resolve(config.storagePath)}\n`);
    console.log('可通过以下地址访问：');
    console.log(`  本机: http://localhost:${config.port}`);

    const localIps = getLocalIpAddresses();
    if (localIps.length > 0) {
      localIps.forEach(ip => {
        console.log(`  局域网: http://${ip}:${config.port}`);
      });
    }

    console.log('\n提示：局域网内其他设备可使用上述局域网地址访问');
    console.log('按 Ctrl+C 停止服务器\n');
  });
});
