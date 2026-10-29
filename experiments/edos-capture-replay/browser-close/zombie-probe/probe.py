import os, sys, time, json, subprocess, hashlib
read_ready, write_ready = os.pipe()
read_exit, write_exit = os.pipe()
started = time.monotonic_ns()
pid = os.fork()
if pid == 0:
    os.close(read_ready)
    os.close(write_exit)
    os.write(write_ready, b'ready')
    os.close(write_ready)
    os.read(read_exit, 1)
    os.close(read_exit)
    os._exit(0)
os.close(write_ready)
os.close(read_exit)
rows = []
reaped = False

def sample(label):
    result = subprocess.run(['ps', '-ww', '-p', str(pid), '-o', 'pid=,ppid=,pgid=,lstart=,stat=,command='], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=False)
    rows.append({'label': label, 'elapsed_ms': (time.monotonic_ns()-started)/1_000_000, 'ps_exit': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr, 'raw_sha256': hashlib.sha256(result.stdout.encode()).hexdigest()})

try:
    assert os.read(read_ready, 5) == b'ready'
    os.close(read_ready)
    sample('owned_child_waiting_before_exit')
    os.write(write_exit, b'x')
    os.close(write_exit)
    time.sleep(0.15)
    sample('exit_released_unreaped_150ms')
    time.sleep(0.15)
    sample('exit_released_unreaped_300ms')
    waited_pid, status = os.waitpid(pid, 0)
    reaped = True
    sample('after_exact_waitpid_reap')
    print(json.dumps({'schema': 'owned-delayed-reap-probe-v1', 'scope': 'own os.fork child only; no browser or product', 'python': sys.version.split()[0], 'parent_pid': os.getpid(), 'fork_child_pid': pid, 'ownership': 'exact os.fork return and pipe handshake; waitpid only this child', 'samples': rows, 'reaped_pid': waited_pid, 'exit_status': os.waitstatus_to_exitcode(status), 'signals_sent': 0}, ensure_ascii=False, indent=2))
finally:
    if not reaped:
        try:
            os.close(write_exit)
        except OSError:
            pass
        os.waitpid(pid, 0)
