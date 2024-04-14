import express, { Request, Response } from 'express';
import connect from './db';
import bcrypt from "bcryptjs";
import nodemailer from 'nodemailer';
import { User, SelectedUsers, Group, AiChat, Meeting, OnlineUser } from './model';
import cors from 'cors';
import path from 'path';
import multer from 'multer';
import fs from 'fs-extra';
import OpenAI from "openai";
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import Replicate from "replicate";
const { GoogleGenerativeAI } = require("@google/generative-ai");
const app = express();
const port = 4000;
app.use(express.json())
app.use(cors())

app.get('/', async (req: Request, res: Response) => {
  res.send('Hello, TypeScript!');
});

const { NEXT_NODE_MAILER_SECRET }: { NEXT_NODE_MAILER_SECRET?: string | undefined } = process.env as { NEXT_NODE_MAILER_SECRET?: string | undefined };

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
