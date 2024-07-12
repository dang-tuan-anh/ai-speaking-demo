require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const pino = require('express-pino-logger')();
const OpenAI = require('openai');
const speechsdk = require('microsoft-cognitiveservices-speech-sdk');const fs = require('fs');
const path = require('path');
const dateAndTime = require('date-and-time');

const app = express();
app.use(bodyParser.json());
app.use(pino);


const openai = new OpenAI({
  apiKey: process.env['OPENAI_API_KEY'], // This is the default and can be omitted
});

// Khởi tạo biến history để lưu trữ các nội dung chat
let history = [{"role": "system", "content": "Bạn là trợ lý khám bệnh. Chỉ được phép chào hỏi user và hỏi những câu hỏi đã được định nghĩa với những lựa chọn trả lời đã có sẵn. Chỉ được phép hỏi sang câu hỏi kế tiếp sau khi user đã trả lời rõ ràng và tường minh. Đây là thứ tự câu hỏi.\n\n1. 初めに、提携先医療機関と受診される科目の注意事項を再度ご確認ください。\t\n・公的医療保険が適用されない自由診療です\n・15歳未満、75歳以上の方はご受診いただけません\n・15歳以上18歳未満の方は保護者の同伴が必要です\n回答）「はい。確認しました。」　「はい」のみはNG\n\n2. 続いて、健康状態や病歴を確認させていただきます。今までにご病気の経験はありますか？\n回答）あり：4問へ　なし：３問へ\n\t\n3. 健康診断などで異常を指摘されたことはありますか？\n\t\n4. 病名をご入力ください。\n\t\n5. 現在、治療中のご病気はありますか？"}]

app.get('/api/get-speech-token', async (req, res, next) => {
    res.setHeader('Content-Type', 'application/json');
    const speechKey = process.env.SPEECH_KEY;
    const speechRegion = process.env.SPEECH_REGION;

    if (speechKey === 'paste-your-speech-key-here' || speechRegion === 'paste-your-speech-region-here') {
        res.status(400).send('You forgot to add your speech key or region to the .env file.');
    } else {
        const headers = {
            headers: {
                'Ocp-Apim-Subscription-Key': speechKey,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        };

        try {
            const tokenResponse = await axios.post(`https://${speechRegion}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, null, headers);
            res.send({ token: tokenResponse.data, region: speechRegion });
        } catch (err) {
            res.status(401).send('There was an error authorizing your speech key.');
        }
    }
});

app.post('/chat', async (req, res) => {
    const userMessage = req.body.message;

    history.push({
        role: 'user',
        content: userMessage
    });

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: buildMessageContext(history, userMessage)
        });

        const systemResponse = response.choices[0].message.content;

        // Convert text response to speech
        const speechConfig = speechsdk.SpeechConfig.fromSubscription(process.env.SPEECH_KEY, process.env.SPEECH_REGION);
        speechConfig.speechSynthesisLanguage = 'ja-JP';
        // Generate file name with timestamp using dateformat
        const timestamp = dateAndTime.format(new Date(), 'YYMMDD_HHmmss');
        const audioFileName = `assistant_${timestamp}.wav`;
        const audioConfig = speechsdk.AudioConfig.fromAudioFileOutput(path.join(__dirname, audioFileName));

        const synthesizer = new speechsdk.SpeechSynthesizer(speechConfig, audioConfig);
        synthesizer.speakTextAsync(
            systemResponse,
            result => {
                if (result) {
                    console.log(`Speech synthesized to file: ${audioFileName}`);
                }
                synthesizer.close();
            },
            error => {
                console.error(`Encountered an error: ${error}`);
                synthesizer.close();
            }
        );

        history.push({
            role: 'system',
            content: systemResponse
        });

        res.json(systemResponse);
    } catch (error) {
        console.error(error);
        res.status(500).send('Có lỗi xảy ra trong quá trình xử lý yêu cầu.');
    }
});

function buildMessageContext(history, userMessage) {
    // Xây dựng ngữ cảnh tin nhắn bao gồm lịch sử và tin nhắn mới từ người dùng
    const messages = [];

    // Thêm ngữ cảnh từ history vào messages
    for (const item of history) {
        messages.push({
            role: item.role,
            content: item.content
        });
    }

    // Thêm tin nhắn mới từ người dùng vào messages
    messages.push({
        role: 'user',
        content: userMessage
    });

    return messages;
}

app.listen(3001, () =>
    console.log('Express server is running on localhost:3001')
);