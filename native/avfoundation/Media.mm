#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreMedia/CoreMedia.h>
#import <AudioToolbox/AudioToolbox.h>
#include "Media.h"
#include <sys/stat.h>
#include <limits.h>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <mutex>
#include <stdexcept>
#include <thread>
#include <vector>
namespace {
using Clock=std::chrono::steady_clock;
void require(bool ok,const char* error){if(!ok)throw std::runtime_error(error);}
NSString* text(id x){require([x isKindOfClass:[NSString class]],"string required");return (NSString*)x;}
long long integer(id x,long long low,long long high){require([x isKindOfClass:[NSNumber class]]&&CFGetTypeID((__bridge CFTypeRef)x)!=CFBooleanGetTypeID(),"integer required");double d=[x doubleValue];require(std::isfinite(d)&&std::floor(d)==d&&d>=low&&d<=high,"integer outside limits");return [x longLongValue];}
NSDictionary* object(const std::string& input,size_t limit=65536){require(input.size()<=limit,"native JSON size limit");NSData*d=[NSData dataWithBytes:input.data() length:input.size()];id x=[NSJSONSerialization JSONObjectWithData:d options:0 error:nullptr];require([x isKindOfClass:[NSDictionary class]],"JSON object required");return x;}
std::string json(id value){NSError*e=nil;NSData*d=[NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingSortedKeys error:&e];require(d!=nil,"JSON serialization failed");return std::string((const char*)d.bytes,d.length);}
std::string errorJson(const char* message){return json(@{@"error":[NSString stringWithUTF8String:message]?:@"native failure"});}
struct File { NSString* path; NSString* identity; };
File localFile(NSString* path){
 const char*s=path.UTF8String;require(s&&path.length>0&&s[0]=='/'&&strlen(s)==[path lengthOfBytesUsingEncoding:NSUTF8StringEncoding],"absolute local path required");
 char real[PATH_MAX];require(realpath(s,real)!=nullptr,"source is unavailable");NSString*p=[NSString stringWithUTF8String:real];NSString*ext=p.pathExtension.lowercaseString;
 require([ext isEqualToString:@"mov"]||[ext isEqualToString:@"mp4"],"only original MOV/MP4 sources supported");
 struct stat st{};require(stat(real,&st)==0&&S_ISREG(st.st_mode)&&st.st_size>0&&st.st_size<=2147483648LL,"source size/type limit");
 auto ns=(long long)st.st_mtimespec.tv_sec*1000000000LL+st.st_mtimespec.tv_nsec;
 return {p,[NSString stringWithFormat:@"%llu:%llu:%lld:%lld",(unsigned long long)st.st_dev,(unsigned long long)st.st_ino,(long long)st.st_size,ns]};
}
void check(std::atomic_bool&cancelled,Clock::time_point deadline){require(!cancelled.load(),"native media cancelled");require(Clock::now()<deadline,"native media deadline exceeded");}
struct CancelReader {
 AVAssetReader* reader;std::atomic_bool done{false};std::thread watcher;
 CancelReader(AVAssetReader*r,std::atomic_bool&c,Clock::time_point deadline):reader(r),watcher([this,&c,deadline]{@autoreleasepool{while(!done.load()){if(c.load()||Clock::now()>=deadline){[reader cancelReading];break;}std::this_thread::sleep_for(std::chrono::milliseconds(20));}}}){}
 ~CancelReader(){done=true;if(watcher.joinable())watcher.join();}
};
struct Source {File file;AVURLAsset* asset;AVAssetTrack* video;AVAssetTrack* audio;int width,height,channels,sourceRate,num,den;};
Source source(NSString* path){
 File f=localFile(path);AVURLAsset*a=[AVURLAsset URLAssetWithURL:[NSURL fileURLWithPath:f.path] options:@{AVURLAssetPreferPreciseDurationAndTimingKey:@YES}];
 NSArray*vs=[a tracksWithMediaType:AVMediaTypeVideo],*as=[a tracksWithMediaType:AVMediaTypeAudio];require(vs.count==1&&as.count==1,"one video and one audio stream required");
 AVAssetTrack*v=vs[0],*au=as[0];require(CGAffineTransformIsIdentity(v.preferredTransform),"rotated video is unsupported");
 require(std::abs(CMTimeGetSeconds(v.timeRange.start))<1.0/48000&&std::abs(CMTimeGetSeconds(au.timeRange.start))<1.0/48000,"nonzero A/V origin unsupported");
 double duration=CMTimeGetSeconds(a.duration);require(std::isfinite(duration)&&duration>0&&duration<=120.000001,"120-second media limit");
 require(v.formatDescriptions.count==1&&au.formatDescriptions.count==1,"changing media format unsupported");
 auto vf=(CMVideoFormatDescriptionRef)(__bridge CFTypeRef)v.formatDescriptions[0];auto af=(CMAudioFormatDescriptionRef)(__bridge CFTypeRef)au.formatDescriptions[0];
 CMVideoDimensions dims=CMVideoFormatDescriptionGetDimensions(vf);const auto*audio=CMAudioFormatDescriptionGetStreamBasicDescription(af);require(audio&&audio->mChannelsPerFrame>=1&&audio->mChannelsPerFrame<=2,"mono/stereo audio required");
 NSDictionary*ext=(__bridge NSDictionary*)CMFormatDescriptionGetExtensions(vf);NSDictionary*par=ext[(__bridge NSString*)kCMFormatDescriptionExtension_PixelAspectRatio];
 if(par){double h=[par[(__bridge NSString*)kCMFormatDescriptionKey_PixelAspectRatioHorizontalSpacing] doubleValue],w=[par[(__bridge NSString*)kCMFormatDescriptionKey_PixelAspectRatioVerticalSpacing] doubleValue];require(h>0&&h==w,"square pixels required");}
 NSNumber*fields=ext[(__bridge NSString*)kCMFormatDescriptionExtension_FieldCount];require(!fields||fields.intValue==1,"progressive video required");
 int n=0,d=1;const int rates[][2]={{24,1},{25,1},{30,1},{50,1},{60,1},{120,1},{24000,1001},{30000,1001},{60000,1001}};
 for(auto&r:rates)if(std::abs(v.nominalFrameRate-(double)r[0]/r[1])<.0002){n=r[0];d=r[1];break;}require(n>0,"unsupported frame rate");
 require(dims.width>0&&dims.width<=16384&&dims.height>0&&dims.height<=16384&&audio->mSampleRate>=1&&audio->mSampleRate<=384000,"invalid media dimensions/sample rate");
 return {f,a,v,au,dims.width,dims.height,(int)audio->mChannelsPerFrame,(int)audio->mSampleRate,n,d};
}
long long videoFrames(Source&s,std::atomic_bool&cancel,Clock::time_point deadline){
 NSError*e=nil;AVAssetReader*r=[[AVAssetReader alloc]initWithAsset:s.asset error:&e];require(r!=nil,"video reader unavailable");AVAssetReaderTrackOutput*out=[AVAssetReaderTrackOutput assetReaderTrackOutputWithTrack:s.video outputSettings:nil];require([r canAddOutput:out],"video reader output unavailable");[r addOutput:out];require([r startReading],"video reader failed");CancelReader watch(r,cancel,deadline);std::vector<CMTime>times;
 while(true){
  check(cancel,deadline);CMSampleBufferRef b=[out copyNextSampleBuffer];if(!b)break;
  const auto count=CMSampleBufferGetNumSamples(b);
  if(count<1||count>14401||(size_t)count+times.size()>14401){CFRelease(b);throw std::runtime_error("invalid video sample count: "+std::to_string(count));}
  // Stored-format readers may group many video frames in one buffer.
  // This API expands shared timing entries into each sample's exact timestamps.
  for(CMItemIndex i=0;i<count;i++){
   CMSampleTimingInfo timing{};const auto code=CMSampleBufferGetSampleTimingInfo(b,i,&timing);
   if(code!=noErr||!CMTIME_IS_NUMERIC(timing.presentationTimeStamp)){CFRelease(b);throw std::runtime_error("video sample timing unavailable");}
   times.push_back(timing.presentationTimeStamp);
  }
  CFRelease(b);
 }
 require(r.status==AVAssetReaderStatusCompleted&&!times.empty(),"video read incomplete");std::sort(times.begin(),times.end(),[](CMTime a,CMTime b){return CMTimeCompare(a,b)<0;});
 for(size_t i=0;i<times.size();i++){double expected=(double)i*s.den/s.num,actual=CMTimeGetSeconds(times[i]);require(std::abs(actual-expected)<=1.01/times[i].timescale,"variable frame rate or video timing discontinuity");if(i)require(CMTimeCompare(times[i],times[i-1])>0,"duplicate video timestamp");}
 double end=(double)times.size()*s.den/s.num;require(std::abs(CMTimeGetSeconds(s.video.timeRange.duration)-end)<=.001,"video duration/frame mismatch");return (long long)times.size();
}
NSData* audioRead(Source&s,long long first,long long count,std::atomic_bool&cancel,Clock::time_point deadline,bool entire=false){
 NSError*e=nil;AVAssetReader*r=[[AVAssetReader alloc]initWithAsset:s.asset error:&e];require(r!=nil,"audio reader unavailable");
 NSDictionary*settings=@{AVFormatIDKey:@(kAudioFormatLinearPCM),AVSampleRateKey:@48000,AVNumberOfChannelsKey:@(s.channels),AVLinearPCMBitDepthKey:@32,AVLinearPCMIsFloatKey:@YES,AVLinearPCMIsBigEndianKey:@NO,AVLinearPCMIsNonInterleaved:@NO};
 AVAssetReaderTrackOutput*out=[AVAssetReaderTrackOutput assetReaderTrackOutputWithTrack:s.audio outputSettings:settings];require([r canAddOutput:out],"PCM output unsupported");[r addOutput:out];require([r startReading],"PCM reader failed");CancelReader watch(r,cancel,deadline);
 NSMutableData*result=[NSMutableData dataWithLength:entire?0:(NSUInteger)(count*s.channels*4)];long long cursor=0,copied=0;
 while(true){check(cancel,deadline);CMSampleBufferRef b=[out copyNextSampleBuffer];if(!b)break;
  auto frames=CMSampleBufferGetNumSamples(b);CMTime pts=CMSampleBufferGetPresentationTimeStamp(b);CMBlockBufferRef block=CMSampleBufferGetDataBuffer(b);
  bool valid=CMTIME_IS_NUMERIC(pts)&&frames>0&&frames<=480000&&block&&CMBlockBufferGetDataLength(block)==(size_t)(frames*s.channels*4);
  if(!valid){CFRelease(b);throw std::runtime_error("invalid PCM sample buffer");}
  long long start=CMTimeConvertScale(pts,48000,kCMTimeRoundingMethod_RoundHalfAwayFromZero).value;
  if(std::llabs(start-cursor)>1){CFRelease(b);throw std::runtime_error("audio timestamp gap/origin mismatch");}
  long long a=std::max(first,cursor),z=std::min(first+count,cursor+frames);
  if(!entire&&z>a){auto code=CMBlockBufferCopyDataBytes(block,(size_t)((a-cursor)*s.channels*4),(size_t)((z-a)*s.channels*4),(char*)result.mutableBytes+(a-first)*s.channels*4);if(code){CFRelease(b);throw std::runtime_error("PCM copy failed");}copied+=z-a;}
  cursor+=frames;CFRelease(b);require(cursor<=120*48000+4800,"audio duration limit");
  if(!entire&&cursor>=first+count){[r cancelReading];break;}
 }
 if(entire){require(r.status==AVAssetReaderStatusCompleted,"audio read incomplete");require(std::abs((double)cursor/48000-CMTimeGetSeconds(s.video.timeRange.duration))<=.05,"A/V duration mismatch");}
 else {require(copied==count,"short PCM window");const float*values=(const float*)result.bytes;for(NSUInteger i=0;i<result.length/4;i++)require(std::isfinite(values[i]),"nonfinite PCM sample");}
 return result;
}
NSDictionary* probe(Source&s,std::atomic_bool&cancel,Clock::time_point deadline){
 long long frames=videoFrames(s,cancel,deadline);audioRead(s,0,0,cancel,deadline,true);require([localFile(s.file.path).identity isEqualToString:s.file.identity],"source changed during probe");
 return @{@"protocol":@"pea-rough-media/1",@"path":s.file.path,@"fileIdentity":s.file.identity,@"providerId":@"avfoundation-v1",@"frameRate":@{@"numerator":@(s.num),@"denominator":@(s.den)},@"durationFrames":[NSString stringWithFormat:@"%lld",frames],@"width":@(s.width),@"height":@(s.height),@"channels":@(s.channels),@"sampleRate":@48000,@"sourceSampleRate":@(s.sourceRate),@"cfr":@YES};
}
std::mutex jobMutex;std::thread worker;std::atomic_bool cancelled{false};std::string jobId,state,result,error;unsigned long long serial=0;
}
namespace pea {
std::string perform(const std::string&input,std::atomic_bool&cancel){@autoreleasepool{@try{try{
 NSDictionary*q=object(input);NSString*op=text(q[@"op"]);auto deadline=Clock::now()+std::chrono::seconds(150);check(cancel,deadline);
 if([op isEqualToString:@"probe"]){Source s=source(text(q[@"path"]));return json(probe(s,cancel,deadline));}
 require([op isEqualToString:@"window"],"unknown native operation");NSDictionary*m=q[@"media"];require([m isKindOfClass:[NSDictionary class]],"media descriptor required");long long first=integer(q[@"startSample"],0,5760000),count=integer(q[@"sampleCount"],1,240000);Source s=source(text(m[@"path"]));
 require([s.file.identity isEqualToString:text(m[@"fileIdentity"])],"source file changed");NSDictionary*verified=probe(s,cancel,deadline);require([verified isEqualToDictionary:m],"media descriptor mismatch");long long total=[m[@"durationFrames"] longLongValue]*s.den*48000/s.num;require(first+count<=total,"PCM window outside media");
 NSData*data=audioRead(s,first,count,cancel,deadline);check(cancel,deadline);require([localFile(s.file.path).identity isEqualToString:s.file.identity],"source changed during PCM read");
 return json(@{@"meta":@{@"startSample":@(first),@"sampleCount":@(count),@"channels":@(s.channels),@"sampleRate":@48000,@"fileIdentity":s.file.identity},@"pcmBase64":[data base64EncodedStringWithOptions:0]});
 }catch(const std::exception&e){return errorJson(e.what());}}@catch(NSException*e){return errorJson("AVFoundation operation raised an exception");}}}
void shutdown(){cancelled=true;if(worker.joinable())worker.join();std::lock_guard<std::mutex>lock(jobMutex);jobId.clear();state.clear();result.clear();error.clear();}
std::string request(const std::string&input){@autoreleasepool{try{
 NSDictionary*q=object(input);NSString*op=text(q[@"op"]);
 if([op isEqualToString:@"probe"]||[op isEqualToString:@"window"]){
  std::lock_guard<std::mutex>lock(jobMutex);require(jobId.empty(),"native job busy; cancel/delete previous job");cancelled=false;jobId=std::to_string(++serial);state="running";result.clear();error.clear();
  worker=std::thread([input]{@autoreleasepool{const auto value=perform(input,cancelled);std::lock_guard<std::mutex>lock(jobMutex);if(cancelled){state="cancelled";}else{try{auto x=object(value,3*1024*1024);if(x[@"error"]){state="failed";error=value;}else{state="completed";result=value;}}catch(const std::exception&e){state="failed";error=errorJson(e.what());}}}});
  return json(@{@"jobId":[NSString stringWithUTF8String:jobId.c_str()]});
 }
 std::string id=[text(q[@"jobId"]) UTF8String];{std::lock_guard<std::mutex>lock(jobMutex);require(!jobId.empty()&&jobId==id,"native job not found");}
 if([op isEqualToString:@"cancel"]){cancelled=true;return "{}";}
 if([op isEqualToString:@"delete"]){shutdown();return "{}";}
 require([op isEqualToString:@"poll"],"unknown native control operation");std::lock_guard<std::mutex>lock(jobMutex);
 NSMutableDictionary*out=[@{@"status":[NSString stringWithUTF8String:state.c_str()]} mutableCopy];if(state=="completed")out[@"result"]=object(result,3*1024*1024);if(state=="failed")out[@"error"]=object(error)[@"error"];return json(out);
 }catch(const std::exception&e){return errorJson(e.what());}}}
}
