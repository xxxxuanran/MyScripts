#!/bin/sh
PATH=/bin:/sbin:/usr/bin:/usr/sbin:/usr/local/bin:/usr/local/sbin:~/bin
export PATH
LANG=en_US.UTF-8
installPath=/opt
arch=$(uname -m)

Check_Arch(){
    if [ "$arch" == "aarch64" -o "$arch" == "arm64" ]; then
        arch="arm64"
    elif [ "$arch" == "x86_64" -o "$arch" == "amd64" ]; then
        arch="amd64"
    elif [ "$arch" == "i686" -o "$arch" == "i386" -o "$arch" == "i486" -o "$arch" == "i586" ]; then
        arch="i686"
    else
        echo "Error: Not support OS Architecture!"
        exit 1
    fi
}

Download_FFMPEG(){
    echo -e "This server's architecture is ${arch}\n"
    fileName="ffmpeg-4.4.1-${arch}-static"
    cd /tmp
    wget -O ${fileName}.tar.xz https://www.johnvansickle.com/ffmpeg/old-releases/${fileName}.tar.xz
    tar -xvf ${fileName}.tar.xz
    rm -rf ${fileName}.tar.xz
    mv ${fileName} ${installPath}/ffmpeg
    ln -s ${installPath}/ffmpeg/ffmpeg /usr/local/bin/ffmpeg
    ln -s ${installPath}/ffmpeg/ffprobe /usr/local/bin/ffprobe
    chmod a+x /etc/ffmpeg/*
}

Main(){
    Check_Arch
    Download_FFMPEG
}

Main