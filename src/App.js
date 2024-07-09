import React, { useState, useEffect, useRef } from 'react';
import { Container } from 'reactstrap';
import { getTokenOrRefresh } from './token_util';
import './custom.css';
import { ResultReason } from 'microsoft-cognitiveservices-speech-sdk';
import AgoraRTC from 'agora-rtc-sdk-ng';
import axios from 'axios';


const speechsdk = require('microsoft-cognitiveservices-speech-sdk');

const APP_ID = process.env.REACT_APP_AGORA_APP_ID; // Replace with your Agora App ID
const TOKEN = process.env.REACT_APP_AGORA_TOKEN; // Replace with your Agora temporary token
const STT_TOKEN = await getTokenOrRefresh();

export default function App() {
    const [displayText, setDisplayText] = useState('INITIALIZED: ready to test speech...');
    const [player, updatePlayer] = useState({ p: undefined, muted: false });
    const [client, setClient] = useState(null);
    const [localTracks, setLocalTracks] = useState({ videoTrack: null, audioTrack: null });
    const [joined, setJoined] = useState(false);
    const [remoteUsers, setRemoteUsers] = useState([]);
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState([]);
    const [isSubmit, setIsSubmit] = useState(false);
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
      }, [messages]);

    useEffect(() => {
        if (isSubmit) {
          handleSubmit();
          setIsSubmit(false);
        }
      }, [isSubmit]);

    const handleSubmit = async (event) => {
        if (event) {
            event.preventDefault();
        }
        const userMessage = { sender: 'user', text: input };
        setMessages([...messages, userMessage]);
        setInput('');

        try {
            const response = await axios.post('http://127.0.0.1:5000/chat', { prompt: input });
            const botMessage = { sender: 'assistant', text: response.data };
            setMessages([...messages, userMessage, botMessage]);
        } catch (error) {
            console.error('Error:', error);
        }
    };


    useEffect(() => {
        const initClient = async () => {
            const agoraClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
            setClient(agoraClient);

            agoraClient.on('user-published', async (user, mediaType) => {
                await agoraClient.subscribe(user, mediaType);
                if (mediaType === 'video') {
                    const remoteVideoTrack = user.videoTrack;
                    remoteVideoTrack.play(`remote-player-${user.uid}`);
                }
                if (mediaType === 'audio') {
                    const remoteAudioTrack = user.audioTrack;
                    remoteAudioTrack.play();
                }

                setRemoteUsers(prevUsers => prevUsers.find(u => u.uid === user.uid) ? prevUsers : [...prevUsers, user]);
            });

            agoraClient.on('user-unpublished', (user) => {
                setRemoteUsers(prevUsers => prevUsers.filter(u => u.uid !== user.uid));
            });
        };
        initClient();
    }, []);

    async function joinChannel() {
        if (client && !joined) {
            await client.join(APP_ID, 'demo_channel', TOKEN, null);
            const [microphoneTrack, cameraTrack] = await AgoraRTC.createMicrophoneAndCameraTracks();
            await client.publish([microphoneTrack, cameraTrack]);

            cameraTrack.play('local-player');

            setLocalTracks({ videoTrack: cameraTrack, audioTrack: microphoneTrack });
            setJoined(true);
        }
    }

    async function leaveChannel() {
        if (client && joined) {
            await client.unpublish([localTracks.audioTrack, localTracks.videoTrack]);
            localTracks.videoTrack.close();
            localTracks.audioTrack.close();
            await client.leave();

            setLocalTracks({ videoTrack: null, audioTrack: null });
            setJoined(false);
            setRemoteUsers([]);
        }
    }

    async function sttFromMic() {
        const speechConfig = speechsdk.SpeechConfig.fromAuthorizationToken(STT_TOKEN.authToken, STT_TOKEN.region);
        const autoDetectConfig = speechsdk.AutoDetectSourceLanguageConfig.fromLanguages(['ja-JP', 'vi-VN', 'en-US']);

        const audioConfig = speechsdk.AudioConfig.fromDefaultMicrophoneInput();
        const recognizer = speechsdk.SpeechRecognizer.FromConfig(speechConfig, autoDetectConfig, audioConfig);

        setDisplayText('speak into your microphone...');

        recognizer.recognizeOnceAsync(result => {
            if (result.reason === ResultReason.RecognizedSpeech) {
                setDisplayText(result.text);
                setInput(result.text);
                setIsSubmit(true);
            } else {
                setDisplayText('ERROR: Speech was cancelled or could not be recognized. Ensure your microphone is working properly.');
            }
        });
    }

    async function textToSpeech() {
        const tokenObj = await getTokenOrRefresh();
        const speechConfig = speechsdk.AutoDetectSourceLanguageConfig
                                    .fromLanguages(['ja-JP', 'vi-VN', 'en-US'])
                                    .fromAuthorizationToken(tokenObj.authToken, tokenObj.region);
        const myPlayer = new speechsdk.SpeakerAudioDestination();
        updatePlayer(p => { p.p = myPlayer; return p; });
        const audioConfig = speechsdk.AudioConfig.fromSpeakerOutput(player.p);

        let synthesizer = new speechsdk.SpeechSynthesizer(speechConfig, audioConfig);

        const textToSpeak = 'This is an example of speech synthesis for a long passage of text. Pressing the mute button should pause/resume the audio output.';
        setDisplayText(`speaking text: ${textToSpeak}...`);
        synthesizer.speakTextAsync(
            textToSpeak,
            result => {
                let text;
                if (result.reason === speechsdk.ResultReason.SynthesizingAudioCompleted) {
                    text = `synthesis finished for "${textToSpeak}".\n`
                } else if (result.reason === speechsdk.ResultReason.Canceled) {
                    text = `synthesis failed. Error detail: ${result.errorDetails}.\n`
                }
                synthesizer.close();
                synthesizer = undefined;
                setDisplayText(text);
            },
            function (err) {
                setDisplayText(`Error: ${err}.\n`);

                synthesizer.close();
                synthesizer = undefined;
            });
    }

    async function handleMute() {
        updatePlayer(p => {
            if (!p.muted) {
                p.p.pause();
                return { p: p.p, muted: true };
            } else {
                p.p.resume();
                return { p: p.p, muted: false };
            }
        });
    }

    async function fileChange(event) {
        const audioFile = event.target.files[0];
        console.log(audioFile);
        const fileInfo = audioFile.name + ` size=${audioFile.size} bytes `;

        setDisplayText(fileInfo);

        const tokenObj = await getTokenOrRefresh();
        const speechConfig = speechsdk.SpeechConfig.fromAuthorizationToken(tokenObj.authToken, tokenObj.region);
        speechConfig.speechRecognitionLanguage = 'en-US';

        const audioConfig = speechsdk.AudioConfig.fromWavFileInput(audioFile);
        const recognizer = new speechsdk.SpeechRecognizer(speechConfig, audioConfig);

        recognizer.recognizeOnceAsync(result => {
            let text;
            if (result.reason === ResultReason.RecognizedSpeech) {
                text = `RECOGNIZED: Text=${result.text}`
            } else {
                text = 'ERROR: Speech was cancelled or could not be recognized. Ensure your microphone is working properly.';
            }

            setDisplayText(fileInfo + text);
        });
    }

    return (
        <Container className="app-container">
            <h1 className="display-4 mb-3">Speaking to AI - Demo</h1>

            <div className="row main-container">
                <div className="col-6">
                    <i className="fas fa-microphone fa-lg mr-2" onClick={() => sttFromMic()}></i>
                    　Convert speech to text from your mic.

                    {/* <div className="mt-2">
                        <label htmlFor="audio-file"><i className="fas fa-file-audio fa-lg mr-2"></i></label>
                        <input
                            type="file"
                            id="audio-file"
                            onChange={(e) => fileChange(e)}
                            style={{ display: "none" }}
                        />
                        Convert speech to text from an audio file.
                    </div>
                    <div className="mt-2">
                        <i className="fas fa-volume-up fa-lg mr-2" onClick={() => textToSpeech()}></i>
                        Convert text to speech.
                    </div>
                    <div className="mt-2">
                        <i className="fas fa-volume-mute fa-lg mr-2" onClick={() => handleMute()}></i>
                        Pause/resume text to speech output.
                    </div> */}
                    <div className="mt-2">
                        <i className="fas fa-video fa-lg mr-2" onClick={() => joinChannel()}></i>
                        　Join Video Call.
                    </div>
                    <div className="mt-2">
                        <i className="fas fa-phone-slash fa-lg mr-2" onClick={() => leaveChannel()}></i>
                        　Leave Video Call.
                    </div>
                    <div id="local-player" style={{ width: '80%', height: '200px' }}></div>
                    {remoteUsers.map(user => (
                        <div key={user.uid} id={`remote-player-${user.uid}`} style={{ width: '80%', height: '200px' }}></div>
                    ))}
                </div>
                <div className="col-6 p-0 chat-window">
                    <div className="messages">
                        {messages.map((msg, index) => (
                            <div key={index} className={`message ${msg.sender}`}>
                                {msg.text}
                            </div>
                        ))}
                        <div ref={messagesEndRef} />
                    </div>
                    <form id="inputForm" onSubmit={handleSubmit} className="input-form">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Type your message..."
                        />
                        <button type="submit">Send</button>
                    </form>
                </div>
                <div className="input-display rounded mt-3">
                    <code>{displayText}</code>
                </div>
            </div>
        </Container>
    );
}
