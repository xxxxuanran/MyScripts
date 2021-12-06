#! /bin/sh

if [ -w '/usr' ]; then
    myPath="/usr/local/qcloud"
else
    myPath="/var/lib/qcloud"
fi

check_user()
{
    if [ "root" != "`whoami`" ]; then
        echo "Only root can execute this script"
        exit 1
    fi
}

remove_YunJing()
{
    source /usr/local/qcloud/YunJing/stopYDCore.sh
    source /usr/local/qcloud/YunJing/YDDelCrontab.sh
    source /usr/local/qcloud/YunJing/uninst.sh
}

remove_stargate()
{
    rm -f /etc/cron.d/sgagenttask
    source /usr/local/qcloud/stargate/admin/stop.sh
    source /usr/local/qcloud/stargate/admin/delcrontab.sh
    source /usr/local/qcloud/stargate/admin/uninstall.sh
}

remove_barad(){
    source /usr/local/qcloud/monitor/barad/admin/stop.sh
    source /usr/local/qcloud/monitor/barad/admin/uninstall.sh
}

remove_outTAT(){
    remove_YunJing
    remove_stargate
    remove_barad
    cd $myPath
    rm -rf !(tat*)
}

remove_all()
{
    remove_YunJing
    remove_stargate
    remove_barad
    rm -rf $myPath
}

uninstall_select()
{
    echo "1. 卸载云镜（主机安全 CWP 业务）"
    echo "2. 卸载云监控（云监控 CM 业务）"
    echo "3. 全部卸载（保留腾讯云自动化助手 TAT）"
    echo "4. 全部卸载"
    read -e -p "请选择（默认为3）:" is_select
}

# Main Start
check_user
is_select = "3"
uninstall_select
if [ ${is_select} == "1" ]; then
    remove_YunJing
elif [ ${is_select} == "2" ]; then
    remove_stargate
    remove_barad
elif [ ${is_select} == "3" ]; then
    remove_outTAT
elif [ ${is_select} == "4" ]; then
    remove_all
fi
# Main End