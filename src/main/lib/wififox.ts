import defaultGateway from 'default-gateway'
import cidrRange from 'cidr-range'
import * as arp from './arp'
import wifi from 'node-wifi'
import ping from './ping'
import spoof from 'spoof'
import os from 'node:os'

const BLOCK_SIZE = 255

const checkIsConnected = () => {
  return new Promise((resolve) => {
    fetch('http://www.apple.com/library/test/success.html')
      .then(async (response) => {
        if (!response.ok) return resolve(false)
        resolve(await response.text() === "<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>")
      })
      .catch(() => resolve(false))
  })
}

let isInit = false
async function init() {
  if (isInit) return
  const { int } = await defaultGateway.v4() // TODO: v6 support
  if (!int) return
  wifi.init({
    iface: int
  })
  isInit = true
}

export async function isOnOpenNetwork() {
  await init()
  const currentConnections = await new Promise((resolve, reject) => {
    wifi.getCurrentConnections(function (err, currentConnections) {
      if (err) return reject(err)
      resolve(currentConnections)
    })
  })
  if (currentConnections.length == 0) {
    return false
  }
  if (currentConnections[0].security !== 'none') { // TODO: maybe not "none" for all OS?
    return false
  }
  return true
}

function isMulticastAddress(mac) {
  return parseInt(mac.split(':')[0], 16) & 1 // 1 in LSB of first octect implies multicast
}

function isBroadcastAddress(mac) {
  return mac === 'FF:FF:FF:FF:FF:FF'
}

export async function listValidMacs() {
  const { gateway, int } = await defaultGateway.v4() // TODO: v6 support
  const iface = os.networkInterfaces()[int].filter(i => i.family === 'IPv4')[0]
  return (await arp.listMACs(gateway))
    .filter(mac => mac !== iface.mac)
    .filter(mac => !isMulticastAddress(mac))
    .filter(mac => !isBroadcastAddress(mac))
}

async function pingScan(int: string, blockCallback) {
  // get interface object
  const iface = os.networkInterfaces()[int].filter(i => i.family === 'IPv4')[0]

  // get all IPs in CIDR range of gateway
  const range = cidrRange(iface.cidr, { onlyHosts: true })

  // ping scan a block of IPs
  let i = 0
  while (i < range.length) {
    const isConnected = await blockCallback()
    if (isConnected) return true

    const block = range.slice(i, i + BLOCK_SIZE)
    console.log('Scanning next block of', BLOCK_SIZE)
    await Promise.all(block.map((ip) => {
      return ping(ip)
    }))
    i += BLOCK_SIZE
  }

  console.log('Scan complete.')
  return false
}

export async function manualScan() {
  const { int } = await defaultGateway.v4() // TODO: v6 support
  await pingScan(int, async () => { return false })
}

async function tryMACs(attemptedMACs, initialSSID, it) {
  const newMACs = (await exports.listValidMacs())
    .filter(mac => attemptedMACs.indexOf(mac) === -1)
  for (let j = 0; j < newMACs.length; ++j) {

    // spoof MAC
    console.log('Trying MAC', newMACs[j])
    spoof.setInterfaceMAC(it.device, newMACs[j], it.port)
    attemptedMACs.push(newMACs[j])

    // force wifi reconnect
    await new Promise((resolve, reject) => {
      wifi.connect({ ssid: initialSSID }, (err) => {
        if (err) return reject(err)
        resolve()
      })
    })

    if (await checkIsConnected()) {
      console.log('Connected with MAC', newMACs[j])
      return true
    }
  }
  console.log('Done trying block of MACs')
  return false
}

export async function connect(silentMode) {
  await init()
  if (await checkIsConnected()) return // try our initial MAC

  // get default gateway, interface name
  const { int } = await defaultGateway.v4() // TODO: v6 support
  const it = spoof.findInterface(int)

  const currentConnections = await new Promise((resolve, reject) => {
    wifi.getCurrentConnections(function (err, currentConnections) {
      if (err) return reject(err)
      resolve(currentConnections)
    })
  })
  if (currentConnections.length == 0) {
    console.log('Not connected to any network')
    throw new Error('Not connected to any network.')
    // TODO: relay this to user in modal
  }
  console.log('Network security', currentConnections[0].security)
  if (currentConnections[0].security !== 'none') { // TODO: maybe not "none" for all OS?
    console.log(currentConnections[0].ssid, 'is not an open network.')
    throw new Error('WiFiFox only works with open networks.')
  }
  const initialSSID = currentConnections[0].ssid
  const iface = os.networkInterfaces()[int].filter(i => i.family === 'IPv4')[0]
  const attemptedMACs = [iface.mac]

  let isConnected = false
  if (silentMode) {
    isConnected = await tryMACs(attemptedMACs, initialSSID, it)
  } else {
    isConnected = await pingScan(int, async () => {
      return await tryMACs(attemptedMACs, initialSSID, it)
    })
  }
  if (isConnected) return

  console.log('Failed to connect with any MAC')
  if (attemptedMACs.length > 1) {
    throw new Error("WiFiFox couldn't bypass the captive portal.")
  } else {
    throw new Error('No other users are on this network.')
  }
}

export async function reset() {
  // get default gateway, interface name
  const { int } = await defaultGateway.v4() // TODO: v6 support
  const it = spoof.findInterface(int)

  spoof.setInterfaceMAC(it.device, it.address, it.port)
}
