#!/bin/bash
# Diagnose what the running npm install process is doing
for PID in $(pgrep -f "npm install" 2>/dev/null); do
  ps -o pid,stat,%cpu,etime,rss,cmd -p "$PID" --no-headers
  echo "state: $(awk '/^State:/{print $2, $3}' /proc/$PID/status 2>/dev/null)"
  echo "open net sockets: $(ls /proc/$PID/fd 2>/dev/null | wc -l) fds"
  echo "last syscall: $(cat /proc/$PID/syscall 2>/dev/null | awk '{print $1}')"
  echo "---"
done
echo "cache tmp dir:"
ls -la /home/quivo/.npm/_cacache/tmp 2>/dev/null | head -5
echo "lock files in ~/.npm/_locks:"
ls -la /home/quivo/.npm/_locks 2>/dev/null
