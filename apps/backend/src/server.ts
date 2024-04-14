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


app.post("/addChat", async (req: Request, res: Response) => {
  try {
    await connect();
    const { message, room_Id, email, selectedUserName } = req.body;
    const currentUserEmail = await User.findOne({ email: email });
    const currentUser = await SelectedUsers.findOne({ username: currentUserEmail?.username });
    const receipentUser = await SelectedUsers.findOne({ username: selectedUserName });
    if (!currentUser || !receipentUser) {
      return res.status(404).json({ error: 'User not found' });
    }


    let currentUserSelectedUser
    let receipentUserSelectedUser
    if (currentUser.selectedUsers) {
      currentUserSelectedUser = currentUser?.selectedUsers.find(user => user.roomId == room_Id);
      // currentUser.selectedUsers.unshift(currentUserSelectedUser);
    }
    if (receipentUser.selectedUsers) {
      receipentUserSelectedUser = receipentUser?.selectedUsers.find(user => user.roomId == room_Id)
      // receipentUser.selectedUsers.unshift(receipentUserSelectedUser);
    }

    if (!currentUserSelectedUser || !receipentUserSelectedUser) {
      return res.status(404).json({ error: 'SelectedUser not found for the specified roomId' })
    }

    const chatObject = { message, isSender: true };
    const receipentChatObject = { message, isSender: false };
    currentUserSelectedUser.lastChatTime = new Date();
    receipentUserSelectedUser.lastChatTime = new Date();
    currentUserSelectedUser.chats.unshift(chatObject);
    receipentUserSelectedUser.chats.unshift(receipentChatObject);
    // console.log(currentUserSelectedUser, receipentUserSelectedUser, "currentUserSelectedUser, receipentUserSelectedUser")

    await currentUser.save();
    await receipentUser.save();

    res.status(200).json({ message: 'Chat added successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
})

app.post("/getChats", async (req: Request, res: Response) => {
  try {
    await connect();
    const { currentUser, selectedUser } = req.body;
    const user = await SelectedUsers.findOne({ username: currentUser });
    const chats = user?.selectedUsers.find(user => user.username === selectedUser);
    if (!chats) {
      return res.status(404).json({ error: 'SelectedUser not found' });
    }
    console.log("before pending")
    chats.pending = 0;
    console.log("after pending")
    await user?.save();
    return res.status(200).json({ chats: chats?.chats, roomId: chats?.roomId, selectedUserPic: chats?.profilePic });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
})

app.post("/getGroupChats", async (req: Request, res: Response) => {
  try {
    const { groupName } = req.body;
    const group = await Group.findOne({ groupName });
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }
    return res.status(200).json({ chats: group.messages });
  } catch (e) { console.log(e) }
})

app.use(express.static(path.join(__dirname, '..', 'public')));


const uploadFile = multer({ dest: 'public/audio' });

app.use(express.static(path.join(__dirname, 'public')));

app.post('/uploadAudio', uploadFile.single('audio'), async (req: Request, res: Response) => {
  try {
    const audioURL = `http://localhost:4000/audio/${req?.file?.filename}`;
    const { roomId, sender, receiver } = req.body
    console.log(1, roomId, sender, receiver)
    await connect();
    const currentUser = await SelectedUsers.findOne({ username: sender });
    const receipentUser = await SelectedUsers.findOne({ username: receiver });

    if (!currentUser || !receipentUser) {
      console.log(2)
      return res.status(404).json({ error: 'User not found' });
    }

    let currentUserSelectedUser;
    let receipentUserSelectedUser;
    if ((currentUser as any).selectedUsers) {
      console.log(3)
      currentUserSelectedUser = (currentUser as any)?.selectedUsers.find((user: any) => user.roomId == roomId);

    }
    if ((receipentUser as any).selectedUsers) {
      console.log(4)
      receipentUserSelectedUser = (receipentUser as any)?.selectedUsers.find((user: any) => user.roomId == roomId);
    }

    if (!currentUserSelectedUser || !receipentUserSelectedUser) {
      console.log(5, currentUserSelectedUser, receipentUserSelectedUser)
      return res.status(404).json({ error: 'SelectedUser not found for the specified roomId' });
    }

    const chatObject = { audioURL: audioURL, isSender: true };
    const receipentChatObject = { audioURL: audioURL, isSender: false };
    currentUserSelectedUser.lastChatTime = new Date();
    receipentUserSelectedUser.lastChatTime = new Date();
    currentUserSelectedUser.chats.unshift(chatObject);
    receipentUserSelectedUser.chats.unshift(receipentChatObject);

    await currentUser.save();
    await receipentUser.save();
    console.log(6)

    res.status(200).send({ audioURL });
  } catch (e) { console.log(e) }
});

app.post('/groupUploadAudio', uploadFile.single('audio'), async (req: Request, res: Response) => {
  try {
    const audioURL = `http://localhost:4000/audio/${req?.file?.filename}`;
    const { roomId, profilePic, sender } = req.body
    const group = await Group.findOne({ roomId: roomId });
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }
    const chatObject = { audioURL: audioURL, profilePic: profilePic, sender: sender };
    group.messages.unshift(chatObject);
    await group.save();
    res.status(200).send({ audioURL });
  } catch (e) {
    console.log(e)
  }
})

// Route to serve audio files
app.get('/audio/:fileName', (req, res) => {
  const fileName = req.params.fileName;
  res.sendFile(path.join(__dirname, 'public', 'audio', fileName));
});


app.get('/getprofilePic/:imagePath', async (req, res) => {
  const { imagePath } = req.params;
  const fullPath = path.join(__dirname, '..', 'public', 'images', 'profilePics', imagePath);
  res.download(fullPath);
});


const upload = multer({ dest: 'public/images/profilePics' });

app.post('/uploadProfilePic', upload.single('profilePic'), async (req: Request, res: Response) => {
  try {
    await connect();
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (req.file) {
      const uniqueFileName = `${Date.now()}_${req.file.originalname}`;
      const filePath = path.join('public', 'images', 'profilePics', uniqueFileName);
      user.profilePic = uniqueFileName;
      await user.save();
      await fs.promises.rename(req.file.path, filePath);
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/uploadGroupProfilePic', upload.single('profilePic'), async (req: Request, res: Response) => {
  try {
    await connect();
    // console.log(req.body, "req.body")
    const { groupName } = req.body;
    const group = await Group.findOne({ groupName });
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }
    if (req.file) {
      const uniqueFileName = `${Date.now()}_${req.file.originalname}`;
      const filePath = path.join('public', 'images', 'profilePics', uniqueFileName);
      group.profilePic = uniqueFileName;
      await group.save();
      await fs.promises.rename(req.file.path, filePath);
    }
    res.status(200).json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post("/getInitlaData", async (req: Request, res: Response) => {
  try {
    await connect()
    const { email } = req.body;
    const user = await User.findOne({ email });
    const selectedUsers = await SelectedUsers.findOne({ username: user?.username });
    const groups = await Group.find({});
    const selectedGroups = await Group.find({
      members: {
        $elemMatch: { username: user?.username }
      }
    });
    return res.status(200).json({ groups: groups, selectedUsers: selectedUsers?.selectedUsers, selectedGroups: selectedGroups, currentUser: user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' })
  }
})


app.post("/addPendingMessages", async (req: Request, res: Response) => {
  try {
    const { recipient, currentUser } = req.body;

    const user = await SelectedUsers.findOne({ username: currentUser });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const recipientUser = user?.selectedUsers.find(user => user.username === recipient);
    if (!recipientUser) {
      return res.status(404).json({ error: 'Recipient not found' });
    }
    recipientUser.pending = recipientUser.pending ? recipientUser.pending + 1 : 1;

    await user?.save();
    return res.status(200).json({ message: 'Pending messages added successfully' });
  } catch (e) { console.log(e) }
})


app.post("/createGroup", async (req: Request, res: Response) => {
  try {
    await connect();
    const { groupName, room_Id, currentUser, selectedGroupMembers, admins } = req.body;
    const updatedAdmins = [currentUser, ...admins];
    const updateMembers = [currentUser, ...selectedGroupMembers];
    const group = new Group({ groupName: groupName, roomId: room_Id, admins: updatedAdmins, members: updateMembers, messages: [] })
    await group.save();
    // const selectedGroups = await Group.find({
    //   members: {
    //     $elemMatch: { username: currentUser?.username }
    //   }
    // });
    const currentGroup = await Group.findOne({ roomId: room_Id });
    // console.log(currentGroup, "currentGroup")
    return res.status(200).json({ message: "Group created successfully", currentGroup: currentGroup });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
})

app.post("/sendRequestToJoinGroup", async (req: Request, res: Response) => {
  try {
    await connect();
    const { groupName, currentUser } = req.body;
    const group = await Group.findOne({ groupName });
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }
    const request = { username: currentUser.username, email: currentUser.email, profilePic: currentUser.profilePic };
    group.requests.unshift(request);
    await group.save();
    return res.status(200).json({ message: 'Request sent successfully' });
  } catch (e) {
    console.log(e);
  }
})

app.post('/addNewMembersToGroup', async (req: Request, res: Response) => {
  try {
    await connect();
    const { groupName, selectedGroupMembers } = req.body;
    console.log(1, groupName, selectedGroupMembers)
    const group = await Group.findOne({ groupName });
    if (!group) {
      console.log(2)
      return res.status(404).json({ error: 'Group not found' });
    }
    const updatedMembers = [...group.members, ...selectedGroupMembers] as any;
    group.members = updatedMembers;
    console.log(3)
    await group.save();
    return res.status(200).json({ message: 'Members added successfully' });
  } catch (e) {
    console.log(e);
  }
})

app.post("/leaveGroup", async (req: Request, res: Response) => {
  try {
    await connect();
    const { groupName, currentUser } = req.body;
    const group = await Group.findOne({ groupName });
    if (!group) {
      return res.status(404).json({ error: "Group not found" });
    }
    if (group.members) {
      group.members.pull({ username: currentUser.username });
    }
    if (group.admins) {
      group.admins.pull({ username: currentUser.username });
    }
    await group.save();
    return res.status(200).json({ message: "Group left successfully" });
  } catch (error) {
    console.log(error)
  }
})

app.post("/addChatInGroup", async (req: Request, res: Response) => {
  try {
    await connect();
    const { message, profilePic, room_Id, currentUser } = req.body;
    console.log(1, req.body)
    const group = await Group.findOne({ roomId: room_Id });
    if (!group) {
      console.log(2)
      return res.status(404).json({ error: "Group not found" });
    }
    const chat = { message: message, profilePic: profilePic, sender: currentUser.username };
    group.messages.unshift(chat);
    await group.save();
    console.log(3)
    return res.status(200).json({ message: "Chat added successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
})


app.post("/archiveUser", async (req: Request, res: Response) => {
  try {
    await connect();
    const { username, selectedUser } = req.body;
    // console.log(req.body)
    const user = await SelectedUsers.findOne({ username: username });
    const archivedUser = user?.selectedUsers.find(user => user.username === selectedUser);
    if (!archivedUser) {
      return res.status(404).json({ error: "User not found" });
    }
    archivedUser.isArchived = true;
    await user?.save();

    return res.status(200).json({ message: "User archived successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post("/deleteUser", async (req: Request, res: Response) => {
  try {
    await connect();
    const { username, selectedUser } = req.body;
    const user = await SelectedUsers.findOne({ username });
    const deletedUser = user?.selectedUsers.find(user => user.username === selectedUser);
    if (!deletedUser) {
      return res.status(404).json({ error: "User not found" });
    }
    user?.selectedUsers.pull(deletedUser);
    await user?.save();
    return res.status(200).json({ message: "User deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
})

app.post("/unArchiveUser", async (req: Request, res: Response) => {
  try {
    await connect();
    const { username, selectedUser } = req.body;
    const user = await SelectedUsers.findOne({ username: username });
    const archivedUser = user?.selectedUsers.find(user => user.username === selectedUser);
    if (!archivedUser) {
      return res.status(404).json({ error: "User not found" })
    }
    archivedUser.isArchived = false;
    await user?.save();
    return res.status(200).json({ message: "User archived successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


app.post("/getArchivedUsers", async (req: Request, res: Response) => {
  try {
    await connect();
    const { username } = req.body;
    const user = await SelectedUsers.findOne({ username });
    const archivedUsers = user?.selectedUsers.filter(user => user.isArchived);
    // console.log(archivedUsers, "archivedUsers")
    const onlineUsers = await OnlineUser.findOne({});
    const onlineUsersArray = onlineUsers?.onlineUsers || [];
    return res.status(200).json({ archivedUsers: archivedUsers, onlineUsers: onlineUsersArray });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
})


app.post("/modelResponse", async (req: Request, res: Response) => {
  const { model, message } = req.body;
  console.log(model, message, "model, message")
  if (model === "antropic") {
    const anthropic = new Anthropic({
      apiKey: process.env.NEXT_CLAUDE_API_KEY,
    });
    const msg = await anthropic.messages.create({
      model: "claude-3-opus-20240229",
      max_tokens: 50,
      messages: [{ role: "user", content: message }],
    });
    console.log(msg, "msg")
    return res.status(200).json({ message: msg });
  } else if (model === "openai") {
    const openai = new OpenAI({ apiKey: process.env.NEXT_OPEN_AI_KEY1 });
    const gptResponse = await openai.completions.create({
      model: "gpt-3.5-turbo-instruct",
      prompt: message,
      max_tokens: 50,
      temperature: 0,
    });
    return res.status(200).json({ message: gptResponse.choices[0].text });
  } else if (model === "gemma") {
    const response = await axios.post("https://api-inference.huggingface.co/models/google/gemma-7b", { inputs: message }, { headers: { Authorization: process.env.NEXT_HUGGING_FACE_KEY } });
    const result = await response.data;
    const generatedText = result[0].generated_text;
    return res.status(200).json({ message: generatedText });
  } else if (model === "meta") {
    // console.log(1)
    const replicate = new Replicate({
      auth: process.env.REPLICATE_API_TOKEN,
    });
    const input = {
      debug: false,
      top_k: -1,
      top_p: 1,
      prompt: message,
      temperature: 0.75,
      system_prompt: "You are a helpful, respectful and honest assistant. Always answer as helpfully as possible, while being safe. Your answers should not include harmful, unethical, racist, sexist, toxic, dangerous, or illegal content. Please ensure that your responses are socially unbiased and positive in nature.\n\nIf a question does not make any sense, or is not factually coherent, explain why instead of answering something not correct. If you don't know the answer to a question, please share false information.",
      max_new_tokens: 80,
      min_new_tokens: -1,
      repetition_penalty: 1
    };
    // console.log(2)
    let result = "";
    for await (const event of replicate.stream("meta/llama-2-7b-chat", { input })) {
      result += event.toString();
    };
    // console.log(3)
    return res.status(200).json({ message: result });
  } else if (model === "mistral") {
    const response = await axios.post("https://api-inference.huggingface.co/models/mistralai/Mixtral-8x7B-Instruct-v0.1", { inputs: message }, { headers: { Authorization: process.env.NEXT_HUGGING_FACE_KEY } });
    const result = await response.data;
    const generatedText = result[0].generated_text;
    const questionIndex = generatedText.indexOf(message);
    const extractedText = generatedText.slice(questionIndex + message.length).trim();
    console.log(extractedText, "result");
    return res.status(200).json({ message: extractedText });
  } else if (model === "gemini") {
    const genAI = new GoogleGenerativeAI(process.env.NEXT_GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    const result = await model.generateContent(message);
    const response = await result.response;
    const text = response.text();
    return res.status(200).json({ message: text });
  }
})

app.post("/addAIChat", async (req: Request, res: Response) => {
  try {
    const { message, currentUsername, model, startingTime, session, endingTime, isSender } = req.body;
    await connect();

    const aiChat = await AiChat.findOne({ currentUsername, session });

    if (aiChat) {
      aiChat.messages.push({ model, isSender: isSender, message });
      aiChat.endingTime = endingTime || aiChat.endingTime;
      aiChat.date = new Date() || aiChat.date;
      await aiChat.save();
      res.status(200).json(aiChat);
    } else {
      const newAiChat = new AiChat({
        messages: [{ model, isSender: isSender, message }],
        currentUsername,
        startingTime,
        endingTime,
        session,
        date: new Date()
      });

      await newAiChat.save();
      res.status(200).json(newAiChat);
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post("/getAIChats", async (req: Request, res: Response) => {
  try {
    await connect();
    const { currentUsername } = req.body;
    const aiChat = await AiChat.find({ currentUsername });
    res.status(200).json(aiChat);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
})

app.post("/shareLink", async (req: Request, res: Response) => {
  try {
    const { currentUser, sharedUsers, roomId } = req.body;
    await connect();

    const user = await SelectedUsers.findOne({ username: currentUser });
    if (!user) {
      return res.status(404).json({ error: "User not found" })
    }
    const matchingUsers: Object[] = [];

    user?.selectedUsers.forEach((selectedUser: any) => {
      sharedUsers.forEach(async (sharedUser: any) => {
        if (selectedUser.username === sharedUser.username) {
          matchingUsers.push(selectedUser);
          selectedUser.chats.unshift({ message: `Let's meet my friend : http://localhost:3000/pages/room/${roomId}`, isSender: true });

          const receipentUser = await SelectedUsers.findOne({ username: sharedUser.username });
          if (!receipentUser) {
            return;
          }
          const receipentUserSelectedUser = receipentUser?.selectedUsers.find(user => user.username === currentUser);
          if (!receipentUserSelectedUser) {
            return;
          }
          receipentUserSelectedUser.chats.unshift({ message: `Let's meet my friend: http://localhost:3000/pages/room/${roomId}`, isSender: false });

          await receipentUser.save();
        }
      });
    });

    await user.save();
    console.log("done")
    res.status(200).json({ message: "Link shared successfully", selectedUsers: matchingUsers });



  } catch (error) {
    console.log(error)
  }
})


app.post("/enterStartMeet", async (req: Request, res: Response) => {
  try {
    const { username, startTime, meetingId, date } = req.body;
    await connect();

    const user = await Meeting.findOne({ username });
    if (!user) {
      const newMeeting = new Meeting({ username, meetings: [{ meetingId, startTime, date, endTime: "" }] });
      await newMeeting.save();
      return res.status(200).json({ message: "Meeting started successfully" });
    }
    const meeting = user?.meetings.find(meeting => meeting.meetingId === meetingId);
    if (!meeting) {
      user?.meetings.push({ meetingId, startTime, date, endTime: "" });
      await user?.save();
      return res.status(200).json({ message: "Meeting started successfully" });
    }
    return res.status(400).json({ message: "Meeting already started" });
  } catch (error) {
    console.log(error)
  }
})

app.post("/enterEndMeet", async (req: Request, res: Response) => {
  try {
    const { username, endTime, meetingId } = req.body;
    await connect();

    const user = await Meeting
      .findOne({ username });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    const meeting = user?.meetings.find(meeting => meeting.meetingId === meetingId);
    if (!meeting) {
      return res.status(404).json({ message: "Meeting not found" });
    }
    meeting.endTime = endTime;
    await user?.save();
    return res.status(200).json({ message: "Meeting ended successfully" });
  } catch (error) {
    console.log(error)
  }
})


app.post('/getMeetings', async (req: Request, res: Response) => {
  console.log("called")
  try {
    const { username } = req.body;
    await connect();
    const user = await Meeting.findOne({ username });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    return res.status(200).json({ meetings: user?.meetings });
  } catch (error) {
    console.log(error)
  }
})

app.post('/addToOnlineUsers', async (req: Request, res: Response) => {
  try {
    const { username } = req.body;
    await connect();
    const user = await OnlineUser.findOne({});
    if (!user) {
      const newUser = new OnlineUser({ onlineUsers: [username] });
      await newUser.save();
      return res.status(200).json({ message: "User added to online users" });
    }
    const isAlreadyPresent = user.onlineUsers.filter(user => user === username);
    if (isAlreadyPresent.length === 0) {
      user.onlineUsers.push(username);
    }
    await user.save();
    return res.status(200).json({ message: "User added to online users" });
  } catch (e) { console.log(e) }
})


app.post('/removeFromOnlineUsers', async (req: Request, res: Response) => {
  try {
    const { username } = req.body;
    await connect();
    const user = await OnlineUser.findOne({});
    if (!user) {
      console.log(2)
      return res.status(404).json({ message: "User not found" });
    }
    user.onlineUsers = user.onlineUsers.filter(user => user !== username);
    // console.log(3)
    await user.save();
    res.status(200).json({ message: "User removed from online users" });
  } catch (e) { console.log(e) }
})


app.post('/deleteAiChat', async (req: Request, res: Response) => {
  try {
    const { currentUsername, chat } = req.body
    await connect();
    const aiChat = await AiChat.deleteOne({ _id: chat._id });
    return res.status(200).json({ message: "Chat deleted successfully" })

  } catch (e) { console.log(e) }
})

app.post('/updateAISuggestions', async (req: Request, res: Response) => {
  try {
    const { currentUsername } = req.body;
    await connect();
    const user = await User.findOne({ username: currentUsername });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    user.aiSuggestions = !user.aiSuggestions;
    await user.save();
    return res.status(200).json({ message: "AI suggestions updated successfully" });
  } catch (e) {
    console.log(e);
  }
})

app.post('/updateDisplayStatus', async (req: Request, res: Response) => {
  try {
    const { currentUsername } = req.body;
    await connect();
    const user = await User.findOne({ username: currentUsername });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    user.dispStatus = !user.dispStatus;
    await user.save();
    return res.status(200).json({ message: "Display status updated successfully" });
  } catch (e) {
    console.log(e);
  }
})

app.post('/sentCode', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    await connect();
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const mailOptions = {
      from: 'aditya.as@somaiya.edu',
      to: email,
      subject: 'Verification Code',
      text: `Your verification code is: ${code}`,
    };
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: 'aditya.as@somaiya.edu', pass: NEXT_NODE_MAILER_SECRET }
    });

    const hasedCode = await bcrypt.hash(code, 5);
    await transporter.sendMail(mailOptions);
    return res.status(200).json({ verificationCode: hasedCode, message: "Verfiication Code has been sent" });
  } catch (e) {
    console.log(e);
  }
})

app.post('/updateEmail', async (req: Request, res: Response) => {
  try {
    const { oldEmail, newEmail, verificationCode, hashedVerificationCode } = req.body;
    console.log(verificationCode, hashedVerificationCode, "verificationCode,hashedVerificationCode")
    const isMatch = await bcrypt.compare(verificationCode, hashedVerificationCode);
    console.log(isMatch, "isMatch")
    if (isMatch) {
      await connect();

      const allUsers = await User.find({});
      const checkEmail = allUsers.filter(user => user.email === newEmail);
      if (checkEmail.length > 0) {
        return res.status(201).json({ message: "Email already in use by some other user " });
      }

      const currentUser = await User.findOne({ email: oldEmail });
      if (!currentUser) {
        return res.status(204).json({ message: "User not found" });
      }
      currentUser.email = newEmail;
      const allUsersSelectedUses = await SelectedUsers.find({});
      for (const user of allUsersSelectedUses) {
        for (const selectedUser of user.selectedUsers) {
          if (selectedUser.email === oldEmail) {
            selectedUser.email = newEmail;
          }
        }
        await user.save();
      }
      await currentUser.save();
      return res.status(200).json({ message: "Email updated successfully" });
    } else {
      return res.status(202).json({ message: "Invalid verification code" });
    }
  } catch (e) {
    console.log(e)
  }
})

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
