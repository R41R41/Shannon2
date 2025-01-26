# Shannon2

\x1b[30m - 黒
\x1b[31m - 赤
\x1b[32m - 緑
\x1b[33m - 黄
\x1b[34m - 青
\x1b[35m - マゼンタ（紫）
\x1b[36m - シアン（水色）
\x1b[37m - 白

Shannon2                                                                  
├─ backend                                                                
│  ├─ node_modules                                                                                                          
│  ├─ src                                                                 
│  │  ├─ config                                                           
│  │  ├─ jobs                                                             
│  │  ├─ models                                                     
│  │  ├─ routes                                                           
│  │  │  └─ discord.routes.ts                                             
│  │  ├─ services                                                         
│  │  │  ├─ discord                                                       
│  │  │  │  ├─ commands                                                   
│  │  │  │  ├─ events                                                     
│  │  │  │  └─ client.ts                                                  
│  │  │  ├─ llm                                                           
│  │  │  │  ├─ config                                                     
│  │  │  │  │  ├─ prompts                                                 
│  │  │  │  │  │  ├─ base_text.txt                                        
│  │  │  │  │  │  ├─ base_voice.txt                                       
│  │  │  │  │  │  ├─ discord_text.txt                                     
│  │  │  │  │  │  └─ discord_voice.txt                                    
│  │  │  │  │  └─ prompts.ts                                              
│  │  │  │  ├─ platforms                                                  
│  │  │  │  ├─ types                                                      
│  │  │  │  │  └─ index.ts                                                
│  │  │  │  ├─ utils                                                      
│  │  │  │  │  └─ errorHandler.ts                                         
│  │  │  │  ├─ client.ts                                                  
│  │  │  │  ├─ eventBus.ts                                                
│  │  │  │  └─ index.ts                                                   
│  │  │  ├─ minecraft                                                     
│  │  │  │  └─ bot.ts                                                     
│  │  │  ├─ twitter                                                       
│  │  │  │  └─ client.ts                                                  
│  │  │  └─ youtube                                                       
│  │  ├─ types                                                            
│  │  ├─ utils                                                            
│  │  │  └─ scheduler.ts                                                  
│  │  └─ server.ts                                                        
│  ├─ package-lock.json                                                   
│  ├─ package.json                                                        
│  └─ tsconfig.json                                                       
├─ frontend                                                               
│  ├─ node_modules                                                                                                             
│  ├─ public                                                              
│  │  └─ vite.svg                                                         
│  ├─ src                                                                 
│  │  ├─ assets                                                           
│  │  │  └─ react.svg                                                     
│  │  ├─ components                                                       
│  │  │  ├─ App                                                           
│  │  │  │  ├─ App.module.scss                                            
│  │  │  │  └─ App.tsx                                                    
│  │  │  └─ ChatSidebar                                                   
│  │  │     ├─ ChatSidebar.css                                            
│  │  │     └─ ChatSidebar.tsx                                            
│  │  ├─ index.css                                                        
│  │  ├─ main.tsx                                                         
│  │  └─ vite-env.d.ts                                                    
│  ├─ eslint.config.js                                                    
│  ├─ index.html                                                          
│  ├─ package-lock.json                                                   
│  ├─ package.json                                                        
│  ├─ tsconfig.app.json                                                   
│  ├─ tsconfig.json                                                       
│  ├─ tsconfig.node.json                                                  
│  └─ vite.config.ts                                                      
├─ README.md                                                              
├─ package-lock.json                                                      
└─ package.json                                                           
