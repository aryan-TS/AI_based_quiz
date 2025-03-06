require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.static('public'));
app.use(express.json());

// Configure multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    }
});

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Extract text from different document types
async function extractText(file) {
    const fileType = path.extname(file.originalname).toLowerCase();
    
    try {
        if (fileType === '.pdf') {
            // Extract text from PDF
            const pdfData = await pdfParse(file.buffer);
            return pdfData.text;
        } else if (fileType === '.docx' || fileType === '.doc') {
            // Extract text from Word document
            const result = await mammoth.extractRawText({ buffer: file.buffer });
            return result.value;
        } else if (fileType === '.txt') {
            // Extract text from plain text file
            return file.buffer.toString('utf8');
        } else {
            throw new Error('Unsupported file type');
        }
    } catch (error) {
        console.error('Error extracting text:', error);
        throw new Error('Failed to extract text from document');
    }
}

// Summarize text using Google's Gemini API
async function summarizeText(text) {
    try {
        const API_KEY = process.env.GEMINI_API_KEY;
        if (!API_KEY) {
            throw new Error('API key not configured');
        }
        
        // Updated API endpoint
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent?key=${API_KEY}`,
            {
                contents: [{
                    parts: [{
                        text: `Please provide a concise summary of the following text:\n\n${text}`
                    }]
                }],
                generationConfig: {
                    temperature: 0.2,
                    maxOutputTokens: 10000
                }
            }
        );
        
        if (response.data && 
            response.data.candidates && 
            response.data.candidates[0] && 
            response.data.candidates[0].content && 
            response.data.candidates[0].content.parts && 
            response.data.candidates[0].content.parts[0]) {
            return response.data.candidates[0].content.parts[0].text;
        } else {
            throw new Error('Invalid response structure from Gemini API');
        }
    } catch (error) {
        console.error('Error summarizing text:', error.response?.data || error.message);
        throw new Error('Failed to summarize document');
    }
}

// Generate mind map from summary
async function generateMindMap(summary) {
    try {
        const API_KEY = process.env.GEMINI_API_KEY;
        if (!API_KEY) {
            throw new Error('API key not configured');
        }
        
        // Updated API endpoint
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent?key=${API_KEY}`,
            {
                contents: [{
                    parts: [{
                        text: `Based on the following summary, create an SVG mind map visualization. The mind map should have a central topic with major branches for key concepts, and sub-branches for details. Make sure the SVG output includes proper styling where all elements are in black and white with more space between each elements\n\n${summary}`
                    }]
                }],
                generationConfig: {
                    temperature: 0.2,
                    maxOutputTokens: 4000
                }
            }
        );
        
        if (response.data && 
            response.data.candidates && 
            response.data.candidates[0] && 
            response.data.candidates[0].content && 
            response.data.candidates[0].content.parts && 
            response.data.candidates[0].content.parts[0]) {
            // Extract SVG content from the response
            const content = response.data.candidates[0].content.parts[0].text;
            const svgMatch = content.match(/<svg[\s\S]*?<\/svg>/);
            
            if (svgMatch) {
                return svgMatch[0];
            } else {
                throw new Error('No SVG found in Gemini API response');
            }
        } else {
            throw new Error('Invalid response structure from Gemini API');
        }
    } catch (error) {
        console.error('Error generating mind map:', error.response?.data || error.message);
        throw new Error('Failed to generate mind map');
    }
}

// Generate quiz questions from summary
async function generateQuiz(summary) {
    try {
        const API_KEY = process.env.GEMINI_API_KEY;
        if (!API_KEY) {
            throw new Error('API key not configured');
        }
        
        const prompt = `
        Based on the following summary, generate a quiz with 5 multiple-choice questions. 
        Each question should have 4 options with only one correct answer.
        
        For each question, provide:
        1. The question text
        2. Four answer options
        3. The index of the correct answer (0-3)
        4. A brief explanation of why the answer is correct
        
        Format the response as a valid JSON array that can be parsed directly:
        [
          {
            "question": "Question text here?",
            "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
            "correctIndex": 0,
            "explanation": "Explanation of the correct answer"
          },
          ...
        ]
        
        Summary:
        ${summary}
        `;
        
        // Updated API endpoint
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent?key=${API_KEY}`,
            {
                contents: [{
                    parts: [{
                        text: prompt
                    }]
                }],
                generationConfig: {
                    temperature: 0.2,
                    maxOutputTokens: 4000
                }
            }
        );
        
        if (response.data && 
            response.data.candidates && 
            response.data.candidates[0] && 
            response.data.candidates[0].content && 
            response.data.candidates[0].content.parts && 
            response.data.candidates[0].content.parts[0]) {
            
            const content = response.data.candidates[0].content.parts[0].text;
            
            // Extract JSON from the response
            const jsonMatch = content.match(/\[\s*\{[\s\S]*\}\s*\]/);
            
            if (jsonMatch) {
                try {
                    const questions = JSON.parse(jsonMatch[0]);
                    return questions;
                } catch (parseError) {
                    console.error('Error parsing JSON quiz data:', parseError);
                    throw new Error('Failed to parse quiz data');
                }
            } else {
                throw new Error('No valid JSON found in Gemini API response');
            }
        } else {
            throw new Error('Invalid response structure from Gemini API');
        }
    } catch (error) {
        console.error('Error generating quiz:', error.response?.data || error.message);
        throw new Error('Failed to generate quiz');
    }
}

// API endpoint for summarizing documents
app.post('/api/summarize', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        // Extract text from document
        const text = await extractText(req.file);
        
        // Summarize text
        const summary = await summarizeText(text);
        
        res.json({ summary });
    } catch (error) {
        console.error('Error processing document:', error);
        res.status(500).json({ error: error.message });
    }
});

// API endpoint for generating mind map
app.post('/api/generate-mindmap', async (req, res) => {
    try {
        const { summary } = req.body;
        
        if (!summary) {
            return res.status(400).json({ error: 'No summary provided' });
        }
        
        // Generate mind map
        const mindMap = await generateMindMap(summary);
        
        res.json({ mindMap });
    } catch (error) {
        console.error('Error generating mind map:', error);
        res.status(500).json({ error: error.message });
    }
});

// API endpoint for generating quiz
app.post('/api/generate-quiz', async (req, res) => {
    try {
        const { summary } = req.body;
        
        if (!summary) {
            return res.status(400).json({ error: 'No summary provided' });
        }
        
        // Generate quiz questions
        const questions = await generateQuiz(summary);
        
        res.json({ questions });
    } catch (error) {
        console.error('Error generating quiz:', error);
        res.status(500).json({ error: error.message });
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});