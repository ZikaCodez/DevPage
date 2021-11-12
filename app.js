const express = require('express');
const app = express();
const router = express.Router();
const webhook = require("webhook-discord");
require('dotenv').config();
const axios = require('axios');
const { MongoClient } = require('mongodb');
const uri = process.env.DB_URI;
const client = new MongoClient(uri, { useNewUrlParser: true });
client.connect();
const db = client.db("MyDB");
const profiles = db.collection("profiles");
const sessions = db.collection("sessions");
const posts = db.collection("posts");
const { validate } = require("email-validator");

app.use('/static', express.static('static'));

const session = require('express-session');

// secrets here
const ipStackAccessKey = 'abcdefg123456';
app.use(session({ secret: 'abcdefg123456', cookie: { maxAge: 14000000000 }}));

app.set("trust proxy", true);

app.set('view engine', 'ejs');

async function getIpData(ip) {
    const { data } = await axios(`http://api.ipstack.com/${ip}?access_key=${ipStackAccessKey}&format=1`);
    return data;
}

router.get('/', async function(req, res) {
    const session = await sessions.findOne({ _id: req.sessionID });
    if (session) {
        const user = await profiles.findOne({ token: session.token });
        const allPosts = await posts.find({}).toArray();
        res.render('index', {user, loggedIn: true, posts: allPosts.reverse()});
    }
    else {
        const allPosts = await posts.find({}).toArray();
        res.render('index', {loggedIn: false, posts: allPosts.reverse()});
    }
});

router.get('/create', function(req, res) {
    res.sendFile(__dirname + '/create.html');
});

router.get('/u/:username', async function(req, res) {
    const user = await profiles.findOne({username: req.params.username});
    if (user) {
        res.render('user', {user});
    } else {
        res.redirect('/error?e=The user you are trying to look for is not found!');
    }
});

router.get('/signup', async function(req, res) {
    const user = await profiles.findOne({email: req.query.email});
    const user2 = await profiles.findOne({username: req.query.username});

    if (!validate(user)) {
        res.redirect('/error?e=Email doesn\'t exist!&b=/create');
    }
    
    if (user || user2) {
        res.redirect('/error?e=Email or username already in use!&b=/create');
    } else {
        const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        const userId = Math.floor(Math.random() * (9900000 - 1000000) + 1000000);

        await profiles.insertOne({
            _id: userId,
            username: req.query.username,
            password: req.query.password,
            email: req.query.email,
            token,
            bio: null,
            avatar: null,
            banner: null,
            projects: [],
            posts: [],
            socials: {github: null, twitter: null, instagram: null, linkedin: null, website: null},
            premium: false,
            verified: false,
            followers: [],
            following: [],
            notifications: [],
            likedPosts: [],
            contributor: false
        });
        
        await sessions.insertOne({_id: req.sessionID, token});
        res.set("Authentication", token);
        res.redirect('/me');

        const Hook = new webhook.Webhook(process.env.SIGNUP_HOOK);
        const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress
        const { country_name } = await getIpData(ip);

        const msg = new webhook.MessageBuilder()
            .setName(user.email)
            .setAvatar(user.avatar || "https://static.thenounproject.com/png/2734299-200.png")
            .setColor("#23b013")
            .setTitle(`${user.username} has signed up`)
            .addField("Location", `>>> **Country :** ${country_name}\n**IP ** \`${ip}\``)
            .addField("Details", `>>> **Session ID :** \`${req.sessionID}\`\n**Email :** ${user.email}\n**Browser :** ${req.headers['user-agent']}`);
        Hook.send(msg);
    }
});

router.get("/me", async function(req, res) {
    const session = await sessions.findOne({_id: req.sessionID});
    if (!session) {
        res.redirect('/login');
        return;
    }
    const token = session.token;
    const user = await profiles.findOne({token});
    if (user) {
        res.render('me', {user});
    }
    else {
        res.redirect('/login');
    }
});

router.get('/login', function(req, res) {
    res.sendFile(__dirname + '/login.html');
});

router.get('/signin', async function(req, res) {
    const user = await profiles.findOne({email: req.query.email});
    if (user) {
        if (user.password == req.query.password) {
            await sessions.deleteOne({token: user.token});
            await sessions.insertOne({_id: req.sessionID, token: user.token});
            res.set("Authentication", user.token);
            res.redirect('/');
            
            const Hook = new webhook.Webhook(process.env.LOGIN_HOOK);
            const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress
            const { country_name } = await getIpData(ip);

            const msg = new webhook.MessageBuilder()
                .setName(req.query.email)
                .setAvatar(user.avatar || "https://static.thenounproject.com/png/2734299-200.png")
                .setColor("#aabbcc")
                .setTitle(`${user.username} has signed in`)
                .addField("Location", `>>> **Country :** ${country_name}\n**IP ** \`${ip}\``)
                .addField("Details", `>>> **Session ID :** \`${req.sessionID}\`\n**Email :** ${user.email}\n**Browser :** ${req.headers['user-agent']}`);
            Hook.send(msg);
        } else {
            res.redirect('/error?e=The password you entered is incorrect!&b=/login');
        }
    } else {
        res.redirect('/error?e=No account found with the given email!&b=/login');
    }
});

router.get('/me/settings', async function(req, res) {
    const session = await sessions.findOne({_id: req.sessionID});
    if (!session) {
        res.redirect('/login');
        return;
    }
    const token = session.token;
    const user = await profiles.findOne({token});
    if (user) {
        res.render('settings', {user});
    }
    else {
        res.redirect('/login');
    }
});

router.get("/update", async function(req, res) {
    const session = await sessions.findOne({_id: req.sessionID});
    if (!session) {
        res.redirect('/login');
        return;
    }
    const token = session.token;
    const user = await profiles.findOne({token});
    if (user) {
        await profiles.updateOne({token}, {$set: {password: req.query.password, username: req.query.username, email: req.query.email, bio: req.query.bio, avatar: req.query.avatar, banner: req.query.banner, about: req.query.about, socials: {github: req.query.github, twitter: req.query.twitter, instagram: req.query.instagram, linkedin: req.query.linkedin, website: req.query.website}}});
        res.redirect('/me');
    }
    else {
        res.redirect('/login');
    }
});

router.get("/publish", async function(req, res) {
    const session = await sessions.findOne({_id: req.sessionID});
    if (!session) {
        res.redirect('/login');
        return;
    }
    const token = session.token;
    const user = await profiles.findOne({token});
    if (user) {
        const postID = Math.floor(Math.random() * (99000 - 10000) + 10000);
        const post = {
            _id: postID,
            content: req.query.content,
            date: new Date(),
            image: req.query.imageURL,
            comments: [],
            likes: 0,
            shares: 0,
            author: user
        }
        await profiles.updateOne({token}, {$push: {posts: post}});
        await posts.insertOne(post);
        res.redirect('/#'+postID);
    }
    else {
        res.redirect('/login');
    }
});

router.get("/logout", async function(req, res) {
    const session = await sessions.findOne({_id: req.sessionID});
    if (!session) {
        res.redirect('/login');
        return;
    }
    const token = session.token;
    const user = await profiles.findOne({token});
    if (user) {
        await sessions.deleteOne({token});
        res.redirect('/');
        
        const Hook = new webhook.Webhook(process.env.LOGOUT_HOOK);
        const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress
        const { country_name } = await getIpData(ip);

        const msg = new webhook.MessageBuilder()
            .setName(user.email)
            .setAvatar(user.avatar || "https://static.thenounproject.com/png/2734299-200.png")
            .setColor("#aabbcc")
            .setTitle(`${user.username} has signed out`)
            .addField("Location", `>>> **Country :** ${country_name}\n**IP ** \`${ip}\``)
            .addField("Details", `>>> **Session ID :** \`${req.sessionID}\`\n**Email :** ${user.email}\n**Browser :** ${req.headers['user-agent']}`);
        Hook.send(msg);

        req.session.destroy();
    }
    else {
        res.redirect('/');
    }
});

router.get("/error", function(req, res) {
    const error = req.query.e || null;
    const back = req.query.b || null;
    res.render('error', {error, back});
});

router.get("/search", async function(req, res) {
    const query = req.query.query;
    const user = await profiles.findOne({username: query});

    res.render('search', {user, query});
});

router.get("/tos", function(req, res) {
    res.sendFile(__dirname + '/tos.html');
});

router.get("/admin", async function(req, res) {
    const session = await sessions.findOne({_id: req.sessionID});
    if (!session) {
        res.redirect('/login');
        return;
    }
    const token = session.token;
    const user = await profiles.findOne({token});
    if (user) {
        if (user._id != 3917634) {
            res.redirect('/error?e=You are not the admin of the site!&b=/');
            return
        }

        const allUsers = await profiles.find({}).toArray();

        res.render('admin', {users: allUsers});
    }
    else {
        res.redirect('/login');
    }
});

router.get("/notify", async function(req, res) {
    const { email, message, title, type } = req.query.email;
    const notificationID = Math.floor(Math.random() * (99000 - 10000) + 10000);
    const session = await sessions.findOne({_id: req.sessionID});
    if (!session) {
        res.redirect('/login');
        return;
    }
    
    let author;
    if (type === "system") {
        author = {username: "System", avatar: "https://static.thenounproject.com/png/2734299-200.png"}
    } else {
        const authorProfile = await profiles.findOne({token: session.token});
        author = {username: authorProfile.username, avatar: authorProfile.avatar, _id: authorProfile._id}
    }

    if (email === "all@all.com") {
        const allUsers = await profiles.find({}).toArray();
        for (let i = 0; i < allUsers.length; i++) {
            const { _id } = allUsers[i];
            await profiles.updateOne({_id}, {$push: {notifications: {id: notificationID, title, message, date: new Date(), author, type}}});
            res.redirect('/back');
        }
    }

    const user = await profiles.findOne({email});
    if (user) {
        await profiles.updateOne({email}, {$push: {notifications: {id: notificationID, title, message, date: new Date(), type, author}}});
        res.redirect('back');
    }
});

router.get("/unnotify", async function(req, res) {
    const notification = req.query.notification;
    const session = await sessions.findOne({_id: req.sessionID});
    if (!session) {
        res.redirect('/login');
        return;
    }
    const token = session.token;
    const user = await profiles.findOne({token});
    if (user) {
        await profiles.updateOne({token}, {$pull: {notifications: {id: JSON.parse(notification).id}}});
        res.redirect('back');
    }
});

router.get("/like", async function(req, res) {
    const postID = parseInt(req.query.postID);
    const session = await sessions.findOne({_id: req.sessionID});
    if (!session) {
        res.redirect('/login');
        return;
    }
    const token = session.token;
    const user = await profiles.findOne({token});
    const post = await posts.findOne({_id: postID});
    if (user.likedPosts.includes(postID)) {
        res.redirect('back');
        return;
    }
    if (user && post) {
        await posts.updateOne({_id: postID}, {$inc: {likes: 1}});
        const authorPosts = await posts.find({author: post.author._id}).toArray();
        await profiles.updateOne({_id: post.author._id}, {$set: {posts: authorPosts}});
        await profiles.updateOne({_id: user._id}, {$push: {likedPosts: postID}});
    }
    res.redirect('back');
});

router.get("/unlike", async function(req, res) {
    const postID = parseInt(req.query.postID);
    const session = await sessions.findOne({_id: req.sessionID});
    if (!session) {
        res.redirect('/login');
        return;
    }
    const token = session.token;
    const user = await profiles.findOne({token});
    const post = await posts.findOne({_id: postID});
    if (!user.likedPosts.includes(postID)) {
        res.redirect('back');
        return;
    }
    if (user && post) {
        await posts.updateOne({_id: postID}, {$inc: {likes: -1}});
        const authorPosts = await posts.find({author: post.author._id}).toArray();
        await profiles.updateOne({_id: post.author._id}, {$set: {posts: authorPosts}});
        await profiles.updateOne({_id: user._id}, {$pull: {likedPosts: postID}});
    }
    res.redirect('back');
});

router.get("/comment", async function(req, res) {
    const postID = parseInt(req.query.postID);
    const comment = req.query.comment;
    const session = await sessions.findOne({_id: req.sessionID});
    if (!session) {
        res.redirect('/login');
        return;
    }
    const user = await profiles.findOne({token: session.token});
    const post = await posts.findOne({_id: postID});
    if (user) {
        await posts.updateOne({_id: postID}, {$set: {comments: {content: comment, author: user, date: new Date()}}});
        await profiles.updateOne({_id: post.author._id}, {$push: {comments: {content: comment, author: user, date: new Date()}}});
    }
    res.redirect('back');
});

router.get("/share", async function(req, res) {
    const session = await sessions.findOne({_id: req.sessionID});
    if (!session) {
        res.redirect('/login');
        return;
    }
    const user = await profiles.findOne({token: session.token});
    if (user) {
        await posts.updateOne({_id: parseInt(req.query.postID)}, {$inc: {shares: 1}});
    }
    res.redirect('back');
});

app.use('/', router);
app.listen(3000);

console.log('Running at Port 3000');
