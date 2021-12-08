$youtube_Link = ""
$format = ""
$m3u8_Link = ""
$output_Link = ""
$retry = 0

function retry {
    if ( $retry -ge 5 ) {
        Write-Output("重试超过5次，退出程序")
        break
    }
    Write-Output("推流已断开，3秒后开始第" + (++$retry) + "次重试")
    Start-Sleep 3
    check
}

function check {
    ${m3u8_Link} = (yt-dlp -g $format $youtube_Link)
    # ${m3u8_Link} = (yt-dlp --proxy socks5://127.0.0.1:7890/ -g $format $youtube_Link)
    if ( ! $m3u8_Link.Count -eq 0 ) {
        run
    }
    else {
        retry
    }
}

function run {
    Write-Output(ffmpeg -re -i $m3u8_Link -c:v copy -c:a aac -f flv -flvflags no_duration_filesize $output_Link)
    # Write-Output(ffmpeg -re -http_proxy http://127.0.0.1:7890/ -i $m3u8_Link -c:v copy -c:a aac -f flv -flvflags no_duration_filesize $output_Link)
    retry
}

function main {
    $youtube_Link = Read-Host '输入Youtube直播链接'
    Write-Output(yt-dlp -F ${youtube_Link})
    # Write-Output(yt-dlp --proxy socks5://127.0.0.1:7890/ -F ${youtube_Link})
    $num = Read-Host '请选择推流画质'
    if ( ! $num -eq 0 ) {
        $format = "-f " + $num
        Write-Output("以选定画质推流")
    }
    else {
        $format = "-f best"
        Write-Output("以最佳画质推流")
    }
    $rtmp_Server = Read-Host '请输入rtmp服务器地址'
    $rtmp_Code = Read-Host '请输入rtmp直播码'
    $output_Link = $rtmp_Server + $rtmp_Code
    check
}

main

Start-Sleep -s 3600