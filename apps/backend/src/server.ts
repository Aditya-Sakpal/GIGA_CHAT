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

app.post('/register', async (req: Request, res: Response) => {
  let verificationCode: string = '';

  const { email, password, enteredVerificationCode, hashedVerificationCode } = req.body;
  if (enteredVerificationCode === null || enteredVerificationCode === undefined) {

    await connect()

    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      return res.status(400).json({ message: "Email is already in use" });
    }
    const generateVerificationCode = () => {
      return Math.floor(1000 + Math.random() * 9000).toString();
    };
    verificationCode = generateVerificationCode();
    const mailOptions = {
      from: 'aditya.as@somaiya.edu',
      to: email,
      subject: 'Verification Code',
      text: `Your verification code is: ${verificationCode}`,
    };
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: 'aditya.as@somaiya.edu',
        pass: NEXT_NODE_MAILER_SECRET,
      },
    });
    try {
      const hasedCode = await bcrypt.hash(verificationCode, 5);
      await transporter.sendMail(mailOptions);
      return res.status(200).json({ verificationCode: hasedCode, message: "Verfiication Code has been sent" });
    }
    catch (error) {
      console.error('Error sending email:', error);
    }
  } else {
    const isMatch = await bcrypt.compare(enteredVerificationCode, hashedVerificationCode);
    if (isMatch) {
      return res.status(200).json({ message: "Valid Code" })
    } else {
      return res.status(400).json({ message: "Invalid verification code" });
    }
  }

})

app.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  await connect();
  const user = await User.findOne({
    email,
  });
  if (!user) {
    return res.status(400).json({ message: "User does not exist" });
  }
  if (user?.provider === "email") {
    const isMatch = await bcrypt.compare(password ?? '', user?.password ?? '');
    if (isMatch) {
      return res.status(200).json({ message: "User has been logged in" });
    } else {
      return res.status(401).json({ message: "Invalid credentials" });
    }
  } else {
    return res.status(201).json({ message: "User has been logged in" });
  }
})


app.post('/enterDetails', async (req: Request, res: Response) => {
  try {
    // console.log(req.body, "req.body")

    const { name, username, phone, email, password, provider } = req.body;
    await connect()

    const hashedPassword = await bcrypt.hash(password, 5);
    const user = new User({ email, password: hashedPassword, name, username, phoneno: phone, provider })
    await user.save();

    return res.status(200).json({ message: "User has been registered" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
})

app.post('/getUsernames', async (req: Request, res: Response) => {
  try {
    // console.log(req.body, "req.body")
    await connect()
    const usernames = await User.find({});
    const currentUser = usernames.filter((user) => user.email === req.body.email);
    const selectedUsers = await SelectedUsers.find({ username: currentUser[0]?.username });
    const filteredSelectedUsers = selectedUsers[0]?.selectedUsers.filter(user => !user.isArchived);
    const onlineUsers = await OnlineUser.findOne({});
    const onlineUsersArray = onlineUsers?.onlineUsers || [];
    return res.status(200).json({ usernames: usernames, selectedUsers: filteredSelectedUsers, currentUser: currentUser[0], onlineUsers: onlineUsersArray });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


app.post('/addUserInSelectedUsers', async (req: Request, res: Response) => {
  try {
    const { email, selectedUser, roomId } = req.body;
    await connect();
    const user = await User.findOne({ email });

    let selectedUserDoc = await SelectedUsers.findOne({ username: user?.username });
    let selectedRecipientDoc = await SelectedUsers.findOne({ username: selectedUser?.username });

    if (!selectedUserDoc) {
      const initializedSelectedUser = {
        ...selectedUser,
        roomId: roomId,
        chats: []
      };

      selectedUserDoc = new SelectedUsers({
        username: user?.username,
        selectedUsers: [initializedSelectedUser]
      });
      await selectedUserDoc.save();
    } else if (selectedUserDoc) {
      if (selectedUserDoc?.selectedUsers?.some(userObj => userObj.username === selectedUser.username)) {
        const existingUserRecord = selectedUserDoc?.selectedUsers.find(user => user.username === selectedUser.username);
        return res.status(400).json({
          message: 'Selected user is already present in the list.',
          existingUserRecord: existingUserRecord,
        });
      } else {
        const userWithRoomId = { ...selectedUser, isArchived: false, roomId: roomId };
        selectedUserDoc.selectedUsers.push(userWithRoomId);
        await selectedUserDoc.save();
      }
    }

    if (!selectedRecipientDoc) {
      const initializedSelectedRecipient = {
        username: user?.username,
        roomId: roomId,
        chats: []
      };

      selectedRecipientDoc = new SelectedUsers({
        username: selectedUser?.username,
        selectedUsers: [initializedSelectedRecipient]
      });

      await selectedRecipientDoc.save();
    } else if (selectedRecipientDoc) {
      let existingUserRecord = selectedRecipientDoc?.selectedUsers.find(currentuser => currentuser.username === user?.username);
      if (existingUserRecord) {
        existingUserRecord.roomId = roomId;
        await selectedRecipientDoc.save();
        return res.status(200).json({ message: 'User added to the selected users list successfully.' });
      }
      else {
        const userWithRoomId = { ...user?.toObject(), isArchived: false, roomId: roomId };
        selectedRecipientDoc.selectedUsers.push(userWithRoomId);
        await selectedRecipientDoc.save();
        return res.status(200).json({ message: 'User added to the selected users list successfully.' });

      }
    }
  }
  catch (error) {
    console.error('Error adding user to selected users list:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
})

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
