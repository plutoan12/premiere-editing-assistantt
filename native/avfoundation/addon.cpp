#include "Media.h"
#include "UxpAddon.h"
#include <vector>
namespace {
addon_value dispatch(addon_env env,addon_callback_info info){
 size_t argc=1;addon_value argv[1]={nullptr};
 if(UxpAddonApis.uxp_addon_get_cb_info(env,info,&argc,argv,nullptr,nullptr)!=addon_ok||argc!=1)return nullptr;
 size_t size=0;if(UxpAddonApis.uxp_addon_get_value_string_utf8(env,argv[0],nullptr,0,&size)!=addon_ok||size>65536)return nullptr;
 std::vector<char>text(size+1);if(UxpAddonApis.uxp_addon_get_value_string_utf8(env,argv[0],text.data(),text.size(),&size)!=addon_ok)return nullptr;
 const std::string output=pea::request(std::string(text.data(),size));addon_value result=nullptr;
 if(UxpAddonApis.uxp_addon_create_string_utf8(env,output.data(),output.size(),&result)!=addon_ok)return nullptr;return result;
}
addon_value init(addon_env env,addon_value exports){addon_value fn=nullptr;
 if(UxpAddonApis.uxp_addon_create_function(env,"request",7,dispatch,nullptr,&fn)!=addon_ok)return nullptr;
 if(UxpAddonApis.uxp_addon_set_named_property(env,exports,"request",fn)!=addon_ok)return nullptr;return exports;
}
void terminate(){pea::shutdown();}
}
UXP_ADDON_INIT(init);
UXP_ADDON_TERMINATE(terminate);
