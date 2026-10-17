/* Cup: stand-in for the Windows SDK's EventToken.h when cross-compiling with MinGW. */
#pragma once
#if defined(__MINGW32__) && !defined(_EVENTTOKEN_H)
#define _EVENTTOKEN_H
typedef struct EventRegistrationToken { __int64 value; } EventRegistrationToken;
#elif !defined(__MINGW32__)
#include <eventtoken.h>
#endif
