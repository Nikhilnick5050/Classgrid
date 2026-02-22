// api/services/chat.js
import Groq from 'groq-sdk';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

// Initialize clients
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const genAI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || process.env.Gemini_API_KEY
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'dummy' });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'dummy' });

const SYSTEM_PROMPT = `
You are Classgrid, an advanced, AI-powered intelligent classroom ecosystem assistant.

CRITICAL INSTRUCTION: You must ALWAYS start your answers, no matter what the user asks, with the exact phrase: "Welcome to Classgrid Classroom! " or "As the Classgrid Classroom AI, ". NEVER present yourself as just a learning platform. Always frame answers in the context of the Classgrid Classroom ecosystem.

━━━━━━━━━━━━━━━━━━━━━━
ORIGIN STORY & EVOLUTION
━━━━━━━━━━━━━━━━━━━━━━
Classgrid originally began as a structured college science project — a comprehensive knowledge base containing over 1000 compounds designed to help students access molecular properties, classifications, and academic references in one centralized platform. The initial modules included a knowledge base, Tutorials, Lectures, and a Review Section, all aimed at simplifying science learning. 

As the platform expanded, Firebase-based authentication and structured learning modules were integrated. However, it became evident that modern online learning remains fragmented, with classroom management, communication, and AI tools scattered across multiple systems. This realization led to the transformation of Classgrid into a full AI-powered classroom ecosystem.

━━━━━━━━━━━━━━━━━━━━━━
WHAT IS CLASSGRID CLASSROOM NOW?
━━━━━━━━━━━━━━━━━━━━━━
Classgrid Classroom is now a unified academic infrastructure featuring role-based access for faculty and students, real-time classroom interaction, structured content management, embedded AI assistance, and secure OAuth authentication.

━━━━━━━━━━━━━━━━━━━━━━
ARCHITECTURE & TECHNOLOGY
━━━━━━━━━━━━━━━━━━━━━━
The backend was redesigned using Node.js and Express with MongoDB for persistent storage and Supabase for real-time updates, ensuring industrial-grade scalability. Authentication supports Google, GitHub, LinkedIn, and email login, with Google OAuth officially verified for compliance and security. The AI system operates on a multi-model routing architecture, using Groq (LLaMA 3.3) as the primary inference engine and Gemini Flash as an automatic fallback to maintain uninterrupted performance. The embedded AI assists with doubt solving, academic explanations, quiz generation, summarization, and classroom workflow support — seamlessly integrated within the learning environment rather than functioning as a separate chatbot.

━━━━━━━━━━━━━━━━━━━━━━
STUDENT EXPERIENCE
━━━━━━━━━━━━━━━━━━━━━━
Students can join classrooms using a classroom code or send a join request that requires faculty approval. They can participate in real-time classroom chat, access notes, quizzes, and announcements, share study materials with peers, and collaborate within a structured academic environment. This system ensures both flexibility for students and proper academic governance.

━━━━━━━━━━━━━━━━━━━━━━
FACULTY FEATURES
━━━━━━━━━━━━━━━━━━━━━━
Faculty members access a centralized Management Hub where they can create and manage classrooms, approve or reject join requests, monitor student participation, upload learning materials, post announcements, create quizzes, track analytics, and monitor engagement in real time. 

━━━━━━━━━━━━━━━━━━━━━━
CONTACT & SUPPORT DETAILS
━━━━━━━━━━━━━━━━━━━━━━
If a student or faculty asks for support or contact details when needed, provide this information:
- Emails: support@classgrid.in
- Phone/WhatsApp: +91 81492 77038
- Address: Pimpri Chinchwad College of Engineering, Sector 26, Pradhikaran, Nigdi, Pune, Maharashtra 411044, India
- Working Hours:
  * Monday - Friday: 9:00 AM - 6:00 PM
  * Saturday: 10:00 AM - 2:00 PM
  * Sunday: Closed
- Social Media & Links:
  * YouTube: https://www.youtube.com/@Classgrid-k6l
  * Facebook: https://www.facebook.com/profile.php?id=61585853281971
  * LinkedIn: https://www.linkedin.com/in/nikhil-shinde-286937367/
  * Instagram: https://www.instagram.com/classgrid25/?hl=en
  * Contact Page: https://www.classgrid.in/contact.html

━━━━━━━━━━━━━━━━━━━━━━
DEVELOPER / FOUNDER / OWNER / CREATOR
━━━━━━━━━━━━━━━━━━━━━━
- Nikhil Shinde

━━━━━━━━━━━━━━━━━━━━━━
YOUR GOAL AS CLASSGRID AI
━━━━━━━━━━━━━━━━━━━━━━
If asked what you are or your history, explain the origin story detailing the shift from a science database to a unified AI Classroom Ecosystem. If asked technical/academic questions, act as the embedded intelligent assistant for students/faculty. Answer queries clearly, politely, and effectively. Remember to position Classgrid as an AI-native ecosystem. Maintain the tone: "Classgrid transforms traditional online classrooms into intelligent, AI-enhanced learning ecosystems."
`;

/**
 * Get a chat reply from Groq (primary model)
 */
async function getGroqReply(message) {
  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: message },
      ],
      temperature: 0.6,
      max_tokens: 1000,
    });

    return response.choices?.[0]?.message?.content || '';
  } catch (error) {
    console.error('Groq API error:', error.message);

    // Check for specific error types that should trigger fallback
    const shouldFallback =
      error.status === 429 || // Rate limit
      error.status === 503 || // Service unavailable
      error.status === 500 || // Server error
      error.status === 401 || // Authentication (key issues)
      error.status === 400 || // Bad request (context length, etc.)
      error.message.includes('token') ||
      error.message.includes('quota') ||
      error.message.includes('limit') ||
      error.message.includes('overloaded') ||
      error.message.includes('timeout') ||
      error.message.includes('ECONNREFUSED');

    if (shouldFallback) {
      console.log(`Groq error detected (${error.status || 'unknown'}), switching to Gemini`);
    }

    throw error; // Propagate error to trigger fallback
  }
}

/**
 * Get a chat reply from Gemini 2.5 Flash (fallback model)
 */
async function getGeminiReply(message) {
  try {
    // Format the prompt for Gemini
    const prompt = `${SYSTEM_PROMPT}\n\nUser Question: ${message}\n\nProvide a clear, academic response:`;

    const response = await genAI.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    return response.text;
  } catch (error) {
    console.error('Gemini API error:', error.message);

    // Check if it's a rate limit or quota issue with Gemini
    if (error.message.includes('429') || error.message.includes('quota')) {
      console.error('Gemini also has rate limit/quota issues!');
    }

    throw new Error(`Gemini fallback failed: ${error.message}`);
  }
}

/**
 * Get a chat reply with automatic fallback routing
 * @param {string} message - User's question
 * @param {string} modelArg - Selected model (default: 'groq')
 * @returns {Promise<string>} AI response
 */
export async function getChatReply(message, modelArg = 'groq') {
  // Track which model was used for this request
  let modelUsed = modelArg;
  let fallbackTriggered = false;
  let fallbackReason = '';

  try {
    const startTime = Date.now();
    let reply = '';

    if (modelArg === 'openai') {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: message }
        ],
        temperature: 0.6,
      });
      reply = response.choices[0].message.content;

    } else if (modelArg === 'claude') {
      const response = await anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1000,
        temperature: 0.6,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: message }]
      });
      reply = response.content[0].text;

    } else if (modelArg === 'gemini') {
      reply = await getGeminiReply(message);
    } else {
      reply = await getGroqReply(message);
    }

    const responseTime = Date.now() - startTime;

    console.log(`✓ Response from ${modelUsed} in ${responseTime}ms`);
    return reply;

  } catch (error) {
    console.log(`✗ Selected model (${modelArg}) failed: ${error.message}`);

    // Fallback to Gemini ONLY if the primary default (Groq) failed
    if (modelArg === 'groq') {
      try {
        console.log(`Attempting Gemini fallback...`);
        const startTime = Date.now();
        const reply = await getGeminiReply(message);
        const responseTime = Date.now() - startTime;
        console.log(`✓ Fallback response from Gemini 2.5 Flash in ${responseTime}ms`);
        return reply;
      } catch (fallbackError) {
        console.error('Both primary and fallback models failed:', fallbackError.message);
      }
    }

    // Log the error internally for debugging
    console.error(`API Error for model ${modelArg}:`, error.message || error);

    // Provide a graceful, generic degradation response.
    return `The selected AI model is currently out of service. We are fixing the issue and it will be back in a while.

To proceed, please try one of these alternatives:

1. **Switch to another AI model in the top right menu**
2. **Email us**: support@classgrid.in
3. **WhatsApp**: +91 81492 77038 (text messages only)`;
  }
}

export async function getVisionReply(message, base64Image, mimeType, modelArg = 'groq') {
  try {
    // For vision, we are using gemini by default unless model is specifically openai
    // OpenAI/Groq Vision models are great, but Gemini 2.5 Flash is excellent for this and cost-effective

    if (modelArg === 'openai') {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: message ? `User Question about image: ${message}` : 'Analyze this academic image and explain what is shown.' },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }
            ]
          }
        ],
        temperature: 0.6,
      });
      return response.choices[0].message.content;
    }

    // Default fallback to Gemini which handles vision well
    const prompt = message ? `${SYSTEM_PROMPT}\n\nUser Question about image: ${message}` : `${SYSTEM_PROMPT}\n\nAnalyze this academic image and explain what is shown.`;

    console.log("Sending image to Gemini Vision...");

    const response = await genAI.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        { text: prompt },
        {
          inlineData: {
            data: base64Image,
            mimeType: mimeType
          }
        }
      ]
    });

    console.log("Vision response received");
    return response.text;
  } catch (error) {
    console.error("Vision API Error:", error);
    return "I successfully received your image but encountered an error analyzing it. Please try uploading a clearer image or try again later.";
  }
}
// Optional utility functions

/**
 * Check the availability of both models
 * Useful for health checks and monitoring dashboards
 */
export async function checkModelAvailability() {
  const status = {
    timestamp: new Date().toISOString(),
    groq: { available: false, model: 'llama-3.3-70b-versatile', responseTime: null },
    gemini: { available: false, model: 'gemini-1.5-flash', responseTime: null },
    recommendedModel: 'groq'
  };

  // Check Groq
  try {
    const groqStart = Date.now();
    await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1
    });
    status.groq.available = true;
    status.groq.responseTime = Date.now() - groqStart;
  } catch (error) {
    status.groq.error = error.message;
    status.groq.statusCode = error.status;
  }

  // Check Gemini
  try {
    const geminiStart = Date.now();
    await geminiModel.generateContent('ping');
    status.gemini.available = true;
    status.gemini.responseTime = Date.now() - geminiStart;
  } catch (error) {
    status.gemini.error = error.message;
  }

  // Determine recommended model
  if (!status.groq.available && status.gemini.available) {
    status.recommendedModel = 'gemini';
  }

  return status;
}

/**
 * Simple test function to verify both models work
 */
export async function testModels() {
  const testMessage = "Explain the Heisenberg Uncertainty Principle in simple terms.";

  console.log('Testing model routing system...\n');
  console.log(`Test question: "${testMessage}"\n`);

  try {
    const response = await getChatReply(testMessage);
    console.log('✅ System is working correctly!');
    console.log(`Response preview: ${response.substring(0, 150)}...\n`);
    return { success: true, responsePreview: response.substring(0, 150) };
  } catch (error) {
    console.error('❌ System test failed:', error.message);
    return { success: false, error: error.message };
  }
}

// Configuration constants (optional, for easy adjustments)
export const MODEL_CONFIG = {
  PRIMARY: {
    provider: 'Groq',
    model: 'llama-3.3-70b-versatile',
    temperature: 0.6,
    maxTokens: 1000
  },
  FALLBACK: {
    provider: 'Google AI',
    model: 'gemini-1.5-flash',
    temperature: 0.6,
    maxTokens: 1000
  },
  FALLBACK_TRIGGERS: [
    'rate limit',
    'quota',
    'service unavailable',
    'timeout',
    'authentication',
    'overloaded'
  ]
};
