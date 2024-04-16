import { spawn } from 'node:child_process';

const linuxPing = (ip) => {
  return new Promise((resolve, _) => {
    const process = spawn('ping', ['-c', '1', ip])
    process.on('close', (code) => {
      resolve()
    })
  })
}

const windowsPing = (ip) => {
  return new Promise((resolve, _) => {
    const process = spawn('ping', ['-n', '1', ip])
    process.on('close', (code) => {
      resolve()
    })
  })
}

const darwinPing = (ip) => {
  return new Promise((resolve, _) => {
    const process = spawn('ping', ['-c', '1', ip])
    process.on('close', (code) => {
      resolve()
    })
  })
}


export default function (ip: string): Promise<unknown> {
  if (process.platform.indexOf('linux') == 0) {
    return linuxPing(ip)
  } else if (process.platform.indexOf('win') == 0) {
    return windowsPing(ip)
  } else if (process.platform.indexOf('darwin') == 0) {
    return darwinPing(ip)
  }

  return Promise.resolve()
}