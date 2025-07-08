'use client';

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";

export default function Home() {
  const {data: session} = authClient.useSession();





  const[name, setName] = useState('');
  const[email, setEmail] = useState('');
  const[password, setPassword] = useState('');

  const handleSubmit = async () => {
    authClient.signUp.email({
      email,
      name,
      password,
    },{
      onError:() =>{
        window.alert("Error creating account. Please try again.");
      },
      onSuccess: () => {
        window.alert("Account created successfully!");
      },
    });
  }

  const handleSubmitLogin = async () => {
    authClient.signIn.email({
      email,
      password,
    },{
      onError:() =>{
        window.alert("Error logging in. Please try again.");
      },
      onSuccess: () => {
        window.alert("Logged in successfully!");
      },
    });
  }


  if(session) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
        <h1 className="text-2xl font-bold mb-4">Welcome, {session.user.name}!</h1>
        <p className="text-lg">You are already logged in.</p>

        <Button onClick={() => authClient.signOut()} className="mt-4">
          Sign Out
        </Button>
      </div>
    );
  }

  return (
    <>
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
      <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <Input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <Input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <Button onClick={handleSubmit} className="mt-4">
        Create A New Account
      </Button>
    </div>


    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
      <Input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <Input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <Button onClick={handleSubmitLogin} className="mt-4">
        Login to Existing Account
      </Button>
    </div>
    </>
    
  );
}
