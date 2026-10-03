#include "Media.h"
#include <iostream>
#include <iterator>
int main(int argc,char**argv){
 if(argc>1&&std::string(argv[1])=="--jobs"){std::string line;while(std::getline(std::cin,line)){std::cout<<pea::request(line)<<std::endl;}pea::shutdown();return 0;}
 std::string input((std::istreambuf_iterator<char>(std::cin)),{});std::atomic_bool cancel{false};const auto result=pea::perform(input,cancel);std::cout<<result<<std::endl;return result.find("\"error\"")==std::string::npos?0:2;
}
