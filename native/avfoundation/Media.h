#pragma once
#include <atomic>
#include <string>
namespace pea {
std::string perform(const std::string& input, std::atomic_bool& cancelled);
std::string request(const std::string& input);
void shutdown();
}
