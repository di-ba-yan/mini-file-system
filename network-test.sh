#!/bin/bash

echo "=== 网络诊断工具 ==="
echo ""

# 1. 检查服务是否在运行
echo "1. 检查服务器端口 3000 是否在监听："
lsof -iTCP:3000 -sTCP:LISTEN -n -P 2>/dev/null
if [ $? -eq 0 ]; then
    echo "✓ 服务器正在运行"
else
    echo "✗ 服务器未运行"
fi
echo ""

# 2. 显示所有网络接口
echo "2. 本机网络接口和IP地址："
ifconfig | grep -E "^[a-z]|inet " | grep -v "127.0.0.1" | grep -v "::1"
echo ""

# 3. 检查防火墙状态
echo "3. 防火墙状态："
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>/dev/null
if [ $? -ne 0 ]; then
    echo "需要管理员权限查看防火墙状态"
fi
echo ""

# 4. 测试本地访问
echo "4. 测试本地访问："
curl -s -o /dev/null -w "HTTP状态码: %{http_code}\n" http://localhost:3000 2>/dev/null
echo ""

# 5. 获取主要的局域网IP
echo "5. 建议使用的局域网访问地址："
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null)
if [ -n "$LOCAL_IP" ]; then
    echo "  http://${LOCAL_IP}:3000"
else
    LOCAL_IP=$(ipconfig getifaddr en1 2>/dev/null)
    if [ -n "$LOCAL_IP" ]; then
        echo "  http://${LOCAL_IP}:3000"
    else
        echo "  未找到活动的网络连接"
    fi
fi
echo ""

echo "=== 诊断完成 ==="
echo ""
echo "如果其他设备无法访问，请尝试："
echo "1. 临时关闭防火墙测试"
echo "2. 确保Mac和其他设备在同一WiFi网络"
echo "3. 检查路由器是否启用了AP隔离"
