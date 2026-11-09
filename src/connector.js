class RTCConnector extends HTMLElement {

    constructor() {
        super();
        this.sdpConstraints = { optional: [{ RtpDataChannels: true }] };
        this.initializePeerConnection();
    }

    connectedCallback() {
        this.debug = this.hasAttribute('debug');
    }

    initializePeerConnection() {
        this.peerConnection = new RTCPeerConnection(null);

        this.peerConnection.addEventListener("iceconnectionstatechange", () => {
            const state = this.peerConnection.iceConnectionState;
            this.fire("iceconnectionstatechange", { state });
            if (state == "connected") {
                this.fire("connected");
            }
            if (state == "failed") {
                this.retryConnection();
                this.fire("iceconnectionstatechange", { state: "retrying" });
            }
        });

        this.peerConnection.addEventListener("icecandidate", (e) => {
            if (e.candidate) return;
            this.fire("localdescriptionchange", { localDescription: this.peerConnection.localDescription });
        });

        this.peerConnection.addEventListener("datachannel", e => this.initializeDataChannel(e.channel));

        return this.peerConnection;
    }

    initializeDataChannel(dc) {
        this.dataChannel = dc || this.peerConnection.createDataChannel("chat");

        this.dataChannel.addEventListener("open", () => this.fire("opened"));
        this.dataChannel.addEventListener("message", e => this.fire("message", { message: e.data }));

        return this.dataChannel;
    }

    send(message) {
        if (this.dataChannel) {
            this.dataChannel.send(message);
            return true;
        } 
        else {
            return false;
        } 
    }

    async startOffering() {
        this.initializeDataChannel();

        const offerDesc = await this.peerConnection.createOffer();
        this.peerConnection.setLocalDescription(offerDesc);
    };

    async acceptOfferAndCreateAnswer(offerSDPData) {
        this.lastOfferSDPData = offerSDPData; // Required to be able to retry later when this attempt is timed out

        const offerDesc = new RTCSessionDescription(offerSDPData);
        this.peerConnection.setRemoteDescription(offerDesc);

        const answerDesc = await this.peerConnection.createAnswer(this.sdpConstraints);
        this.peerConnection.setLocalDescription(answerDesc);
    };

    acceptAnswer(answerSDPData) {
        const answerDesc = new RTCSessionDescription(answerSDPData);
        this.peerConnection.setRemoteDescription(answerDesc);
    }

    retryConnection() {
        this.initializePeerConnection();

        if (this.lastOfferSDPData) {
            createAnswerSDP(this.lastOfferSDPData);
        }
    }

    fire(eventType, detailData = {}) {
        if (this.debug) {
          console.log(`Event '${eventType}'`, detailData);
        }
        this.dispatchEvent(new CustomEvent(eventType, { detail: detailData }));
    }

}

customElements.define('rtc-connector', RTCConnector);

// Shrinks the SDP JSON before it goes into a QR code, using the browser's
// built-in (de)compression - no external dependency needed.

async function encodeSDP(description, { stripUnusedCandidates = false } = {}) {
  const data = stripUnusedCandidates ? { type: description.type, sdp: pruneSdp(description.sdp) } : description;
  const stream = new Blob([JSON.stringify(data)]).stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  const buffer = await new Response(stream).arrayBuffer();
  return bufferToBase64(buffer);
}

async function decodeSDP(base64) {
  const stream = new Blob([base64ToBuffer(base64)]).stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const json = await new Response(stream).text();
  return JSON.parse(json);
}

// Removes ICE-TCP candidates (practically never usable without a TURN
// server) and other attributes that only make sense for audio/video
// m-lines, not for our data-channel-only SDP.
function pruneSdp(sdpText) {
  const seenSendrecv = new Set();
  return sdpText.split("\r\n").filter(line => {
    if (/^a=candidate:\d+ \d+ TCP /.test(line)) return false;
    if (line === "a=msid-semantic:WMS *") return false;
    if (line === "a=sendrecv") {
      if (seenSendrecv.has(line)) return false;
      seenSendrecv.add(line);
    }
    return true;
  }).join("\r\n");
}

function bufferToBase64(buffer) {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
