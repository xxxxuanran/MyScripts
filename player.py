import subprocess
import sys

rtmp_serv = "rtmp://txy2.live-push.bilivideo.com/live-bvc/"
rtmp_code = "?streamname=live_42615888_4223852&key=b03e10140d1f2a80e6466bb8e34dc0b6&schedule=rtmp&pflag=1"

def streamlink_play(link):
    global rtmp_serv, rtmp_code
    rtmp_link = rtmp_serv + rtmp_code
    streamlink_input_args = ['--http-proxy', 'http://127.0.0.1:7890/', '--stream-segment-threads', '5', '--hls-playlist-reload-attempts', '1', '--retry-max', '100']
    streamlink_cmd = ['streamlink', *streamlink_input_args, link, 'best', '-O']
    player_cmd = ['D:\\Program Files\\PotPlayer\\PotPlayerMini64.exe', '-']
    ffmpeg_cmd = ['ffmpeg', '-re', '-i', 'pipe:0',
                  '-rw_timeout', '20000000', '-bsf:a', 'aac_adtstoasc',
                  '-c', 'copy', '-f', 'flv', rtmp_link]
    streamlink_proc = subprocess.Popen(streamlink_cmd, stdout=subprocess.PIPE)
    # player_proc = subprocess.Popen(player_cmd, stdin=streamlink_proc.stdout)
    ffmpeg_proc = subprocess.Popen(ffmpeg_cmd, stdin=streamlink_proc.stdout,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        with ffmpeg_proc.stdout as stdout:
            for line in iter(stdout.readline, b''):
                decode_line = line.strip().rstrip()
                if decode_line == '':
                    continue
                print(decode_line)
        # retval = player_proc.wait()
        retval = ffmpeg_proc.wait()
        streamlink_proc.terminate()
        streamlink_proc.wait()
    except KeyboardInterrupt:
        if sys.platform != 'win32':
            ffmpeg_proc.communicate(b'q')
        raise
    return retval

if __name__ == '__main__':
    url = "https://www.youtube.com/watch?v=K4oPpnAEvz8"
    r = streamlink_play(url)
