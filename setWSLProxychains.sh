#!/bin/sh
hostip=$(cat /etc/resolv.conf | grep nameserver | awk '{ print $2 }')
wslip=$(hostname -I | awk '{print $1}')
port=7890
sed -i '$d' /etc/proxychains4.conf
echo "socks5 ${hostip} ${port}" >> /etc/proxychains4.conf
ip4=$(pc -q curl -s https://api-ipv4.ip.sb/ip)
echo -e "My IP address is: $ip4"