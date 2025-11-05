// 全局状态
const state = {
  currentPath: '',
  files: [],
  selectedFiles: new Set(),
  uploading: false
};

// DOM元素
const elements = {
  fileList: document.getElementById('fileList'),
  uploadBtn: document.getElementById('uploadBtn'),
  uploadFolderBtn: document.getElementById('uploadFolderBtn'),
  createFolderBtn: document.getElementById('createFolderBtn'),
  downloadBtn: document.getElementById('downloadBtn'),
  deleteBtn: document.getElementById('deleteBtn'),
  fileInput: document.getElementById('fileInput'),
  folderInput: document.getElementById('folderInput'),
  breadcrumb: document.getElementById('breadcrumb'),
  dropZone: document.getElementById('dropZone'),
  uploadProgress: document.getElementById('uploadProgress'),
  progressFill: document.getElementById('progressFill'),
  progressText: document.getElementById('progressText'),
  progressDetails: document.getElementById('progressDetails'),
  closeProgress: document.getElementById('closeProgress')
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  loadFiles();
  bindEvents();
});

// 绑定事件
function bindEvents() {
  elements.uploadBtn.addEventListener('click', () => elements.fileInput.click());
  elements.uploadFolderBtn.addEventListener('click', () => elements.folderInput.click());
  elements.createFolderBtn.addEventListener('click', createFolder);
  elements.fileInput.addEventListener('change', handleFileSelect);
  elements.folderInput.addEventListener('change', handleFolderSelect);
  elements.downloadBtn.addEventListener('click', downloadSelected);
  elements.deleteBtn.addEventListener('click', deleteSelected);
  elements.closeProgress.addEventListener('click', () => {
    elements.uploadProgress.classList.add('hidden');
  });

  // 拖拽上传
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    elements.dropZone.classList.remove('hidden');
    elements.dropZone.classList.add('drag-over');
  });

  document.addEventListener('dragleave', (e) => {
    if (e.target === document || e.target === document.documentElement) {
      elements.dropZone.classList.remove('drag-over');
      elements.dropZone.classList.add('hidden');
    }
  });

  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    elements.dropZone.classList.remove('drag-over');
    elements.dropZone.classList.add('hidden');

    // 处理文件夹拖拽
    const items = Array.from(e.dataTransfer.items);
    if (items.length > 0 && items[0].webkitGetAsEntry) {
      const fileList = await getAllFilesFromItems(items);
      if (fileList.length > 0) {
        uploadFilesWithPath(fileList);
      }
    } else {
      // 回退到普通文件处理
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        uploadFiles(files);
      }
    }
  });
}

// 加载文件列表
async function loadFiles(path = '') {
  try {
    state.currentPath = path;
    state.selectedFiles.clear();
    updateButtons();

    elements.fileList.innerHTML = '<div class="loading">加载中...</div>';

    const response = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
    const data = await response.json();

    state.files = data.files || [];
    renderFiles();
    renderBreadcrumb();
  } catch (error) {
    console.error('加载文件失败:', error);
    elements.fileList.innerHTML = '<div class="empty">加载失败</div>';
  }
}

// 渲染面包屑
function renderBreadcrumb() {
  const parts = state.currentPath ? state.currentPath.split('/') : [];
  let html = '<span data-path="">根目录</span>';

  let currentPath = '';
  for (const part of parts) {
    if (part) {
      currentPath += (currentPath ? '/' : '') + part;
      html += ` / <span data-path="${currentPath}">${part}</span>`;
    }
  }

  elements.breadcrumb.innerHTML = html;

  // 绑定面包屑点击事件
  elements.breadcrumb.querySelectorAll('span').forEach(span => {
    span.addEventListener('click', () => {
      const path = span.getAttribute('data-path');
      loadFiles(path);
    });
  });
}

// 渲染文件列表
function renderFiles() {
  if (state.files.length === 0) {
    elements.fileList.innerHTML = '<div class="empty">暂无文件</div>';
    return;
  }

  const html = state.files.map(file => {
    const isDirectory = file.type === 'directory';
    const icon = isDirectory ? '📁' : '📄';
    const size = isDirectory ? '-' : formatFileSize(file.size);
    const date = new Date(file.modified).toLocaleString('zh-CN');

    return `
      <div class="file-item" data-path="${file.path}" data-type="${file.type}">
        <input type="checkbox" class="file-checkbox" data-path="${file.path}">
        <div class="file-icon">${icon}</div>
        <div class="file-info">
          <div class="file-name">${file.name}</div>
          <div class="file-meta">
            <span>${size}</span>
            <span>${date}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  elements.fileList.innerHTML = html;

  // 绑定文件项事件
  elements.fileList.querySelectorAll('.file-item').forEach(item => {
    const checkbox = item.querySelector('.file-checkbox');
    const path = item.getAttribute('data-path');
    const type = item.getAttribute('data-type');

    // 复选框事件
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      if (checkbox.checked) {
        state.selectedFiles.add(path);
        item.classList.add('selected');
      } else {
        state.selectedFiles.delete(path);
        item.classList.remove('selected');
      }
      updateButtons();
    });

    // 点击文件项
    item.addEventListener('click', (e) => {
      if (e.target === checkbox) return;

      if (type === 'directory') {
        loadFiles(path);
      } else {
        // 单击文件时选中/取消选中
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
      }
    });

    // 双击文件下载
    item.addEventListener('dblclick', (e) => {
      e.preventDefault();
      if (type === 'file') {
        downloadFile(path);
      }
    });
  });
}

// 格式化文件大小
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// 更新按钮状态
function updateButtons() {
  const hasSelection = state.selectedFiles.size > 0;
  elements.downloadBtn.disabled = !hasSelection;
  elements.deleteBtn.disabled = !hasSelection;
}

// 处理文件选择
function handleFileSelect(e) {
  const files = Array.from(e.target.files);
  if (files.length > 0) {
    uploadFiles(files);
  }
  e.target.value = ''; // 重置input以允许重复选择同一文件
}

// 处理文件夹选择
function handleFolderSelect(e) {
  const files = Array.from(e.target.files);
  if (files.length > 0) {
    // 将文件转换为带路径的格式
    const filesWithPath = files.map(file => ({
      file: file,
      relativePath: file.webkitRelativePath || file.name
    }));
    uploadFilesWithPath(filesWithPath);
  }
  e.target.value = ''; // 重置input以允许重复选择同一文件
}

// 从拖拽项目中获取所有文件（支持文件夹）
async function getAllFilesFromItems(items) {
  const files = [];

  async function traverseEntry(entry, path = '') {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => {
        entry.file(resolve, reject);
      });
      files.push({
        file: file,
        relativePath: path + file.name
      });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const entries = await new Promise((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });

      for (const childEntry of entries) {
        await traverseEntry(childEntry, path + entry.name + '/');
      }
    }
  }

  for (const item of items) {
    const entry = item.webkitGetAsEntry();
    if (entry) {
      await traverseEntry(entry);
    }
  }

  return files;
}

// 上传文件
async function uploadFiles(files) {
  if (state.uploading) return;

  state.uploading = true;
  elements.uploadProgress.classList.remove('hidden');

  const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
  let completedFiles = 0;

  for (const file of files) {
    try {
      elements.progressText.textContent = `上传: ${file.name}`;

      // 小文件直接上传
      if (file.size < CHUNK_SIZE) {
        await uploadSimple(file);
      } else {
        // 大文件分片上传
        await uploadChunked(file, CHUNK_SIZE);
      }

      completedFiles++;
      updateProgress(completedFiles, files.length);
    } catch (error) {
      console.error(`上传文件 ${file.name} 失败:`, error);
      elements.progressDetails.textContent = `上传失败: ${error.message}`;
    }
  }

  state.uploading = false;
  setTimeout(() => {
    elements.uploadProgress.classList.add('hidden');
    loadFiles(state.currentPath);
  }, 1500);
}

// 上传带路径的文件（支持文件夹结构）
async function uploadFilesWithPath(filesWithPath) {
  if (state.uploading) return;

  state.uploading = true;
  elements.uploadProgress.classList.remove('hidden');

  const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
  let completedFiles = 0;

  for (const item of filesWithPath) {
    try {
      const file = item.file;
      const relativePath = item.relativePath;

      // 提取文件所在的目录路径
      const lastSlash = relativePath.lastIndexOf('/');
      const dirPath = lastSlash > 0 ? relativePath.substring(0, lastSlash) : '';
      const fileName = lastSlash > 0 ? relativePath.substring(lastSlash + 1) : relativePath;

      elements.progressText.textContent = `上传: ${relativePath}`;

      // 小文件直接上传
      if (file.size < CHUNK_SIZE) {
        await uploadSimple(file, dirPath, fileName);
      } else {
        // 大文件分片上传
        await uploadChunked(file, CHUNK_SIZE, dirPath, fileName);
      }

      completedFiles++;
      updateProgress(completedFiles, filesWithPath.length);
    } catch (error) {
      console.error(`上传文件 ${item.relativePath} 失败:`, error);
      elements.progressDetails.textContent = `上传失败: ${error.message}`;
    }
  }

  state.uploading = false;
  setTimeout(() => {
    elements.uploadProgress.classList.add('hidden');
    loadFiles(state.currentPath);
  }, 1500);
}

// 简单上传（小文件）
async function uploadSimple(file, dirPath = null, fileName = null) {
  const formData = new FormData();

  // 如果提供了自定义文件名，需要创建一个新的File对象
  const fileToUpload = fileName ? new File([file], fileName, { type: file.type }) : file;

  formData.append('files', fileToUpload);

  // 如果提供了dirPath，使用它；否则使用当前路径
  const uploadPath = dirPath !== null
    ? (state.currentPath ? `${state.currentPath}/${dirPath}` : dirPath)
    : state.currentPath;
  formData.append('relativePath', uploadPath);

  const response = await fetch('/api/upload', {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    throw new Error('上传失败');
  }
}

// 分片上传（大文件）
async function uploadChunked(file, chunkSize, dirPath = null, fileName = null) {
  const totalChunks = Math.ceil(file.size / chunkSize);
  let uploadId = null;

  // 确定最终的文件名和路径
  const finalFileName = fileName || file.name;
  const uploadPath = dirPath !== null
    ? (state.currentPath ? `${state.currentPath}/${dirPath}` : dirPath)
    : state.currentPath;

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const chunk = file.slice(start, end);

    const formData = new FormData();
    formData.append('chunk', chunk);
    formData.append('chunkIndex', i);
    formData.append('totalChunks', totalChunks);
    formData.append('fileName', finalFileName);
    formData.append('relativePath', uploadPath);
    if (uploadId) {
      formData.append('uploadId', uploadId);
    }

    const response = await fetch('/api/upload-chunk', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error('分片上传失败');
    }

    const data = await response.json();
    uploadId = data.uploadId;

    elements.progressDetails.textContent = `分片 ${i + 1}/${totalChunks}`;
    updateProgress(i + 1, totalChunks);
  }

  // 合并分片
  elements.progressDetails.textContent = '合并文件...';
  const mergeResponse = await fetch('/api/merge-chunks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId })
  });

  if (!mergeResponse.ok) {
    throw new Error('合并文件失败');
  }
}

// 更新进度
function updateProgress(current, total) {
  const percent = Math.round((current / total) * 100);
  elements.progressFill.style.width = percent + '%';
}

// 下载单个文件
function downloadFile(path) {
  window.location.href = `/api/download/${encodeURIComponent(path)}`;
}

// 下载选中的文件
async function downloadSelected() {
  const paths = Array.from(state.selectedFiles);
  if (paths.length === 0) return;

  if (paths.length === 1) {
    // 单个文件直接下载
    downloadFile(paths[0]);
  } else {
    // 多个文件打包下载
    try {
      const response = await fetch('/api/download-multiple', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: paths })
      });

      if (!response.ok) {
        throw new Error('下载失败');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `files-${Date.now()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('下载失败:', error);
      alert('下载失败');
    }
  }
}

// 删除选中的文件
async function deleteSelected() {
  const paths = Array.from(state.selectedFiles);
  if (paths.length === 0) return;

  const confirmed = confirm(`确定要删除 ${paths.length} 个文件/文件夹吗？`);
  if (!confirmed) return;

  try {
    const response = await fetch('/api/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths })
    });

    if (!response.ok) {
      throw new Error('删除失败');
    }

    await loadFiles(state.currentPath);
  } catch (error) {
    console.error('删除失败:', error);
    alert('删除失败');
  }
}

// 创建新文件夹
async function createFolder() {
  const folderName = prompt('请输入文件夹名称:');

  if (!folderName) return;

  // 去除首尾空格
  const trimmedName = folderName.trim();

  if (!trimmedName) {
    alert('文件夹名称不能为空');
    return;
  }

  // 检查非法字符
  if (/[<>:"|?*\\\/]/.test(trimmedName)) {
    alert('文件夹名称包含非法字符');
    return;
  }

  try {
    const response = await fetch('/api/create-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderName: trimmedName,
        relativePath: state.currentPath
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || '创建失败');
    }

    await loadFiles(state.currentPath);
  } catch (error) {
    console.error('创建文件夹失败:', error);
    alert(`创建文件夹失败: ${error.message}`);
  }
}
