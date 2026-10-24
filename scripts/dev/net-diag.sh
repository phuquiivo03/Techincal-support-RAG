#!/bin/bash
# What network config and connections does the npm process have?
PID=$(pgrep -f "npm install" | head -1)
echo "=== npm config (proxy-related) ==="
npm config get proxy registry https-proxy cafile 2>/dev/null
echo "=== env proxies ==="
env | grep -iE "proxy|http_|https_" | sed 's/=.*/=<set>/' || true
echo "=== TCP connections of $PID ==="
ss -tnp 2>/dev/null | grep "pid=$PID" | head -10
echo "=== any npm config files ==="
ls -la /home/quivo/.npmrc /etc/npmrc 2>/dev/null; grep -vE "auth|token" /home/quivo/.npmrc 2>/dev/null | head -10
