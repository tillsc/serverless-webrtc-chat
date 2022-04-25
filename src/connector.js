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
                retryConnection();
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
            createAnswerSDP(lastOfferSDPData);
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
