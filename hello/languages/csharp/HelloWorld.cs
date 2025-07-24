using System;
using System.Configuration;
using System.IO;
using Newtonsoft.Json;

namespace HelloWorld
{
    // Configuration model
    public class AppConfig
    {
        public string Message { get; set; } = "Hello, World!";
        public string Language { get; set; } = "en";
        public bool EnableLogging { get; set; } = true;
        public string LogPath { get; set; } = "./logs";
    }

    class Program
    {
        private static AppConfig _config;
        private static readonly string ConfigPath = "appsettings.json";

        static void Main(string[] args)
        {
            try
            {
                // Load configuration
                LoadConfiguration();

                // Parse command line arguments
                ParseArguments(args);

                // Display message
                DisplayMessage();

                // Log if enabled
                if (_config.EnableLogging)
                {
                    LogMessage();
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Error: {ex.Message}");
                Environment.Exit(1);
            }
        }

        private static void LoadConfiguration()
        {
            try
            {
                if (File.Exists(ConfigPath))
                {
                    string json = File.ReadAllText(ConfigPath);
                    _config = JsonConvert.DeserializeObject<AppConfig>(json);
                }
                else
                {
                    _config = new AppConfig();
                    SaveConfiguration();
                }
            }
            catch
            {
                _config = new AppConfig();
            }
        }

        private static void SaveConfiguration()
        {
            string json = JsonConvert.SerializeObject(_config, Formatting.Indented);
            File.WriteAllText(ConfigPath, json);
        }

        private static void ParseArguments(string[] args)
        {
            for (int i = 0; i < args.Length; i++)
            {
                switch (args[i])
                {
                    case "--message":
                    case "-m":
                        if (i + 1 < args.Length)
                        {
                            _config.Message = args[++i];
                        }
                        break;
                    case "--no-log":
                        _config.EnableLogging = false;
                        break;
                    case "--help":
                    case "-h":
                        ShowHelp();
                        Environment.Exit(0);
                        break;
                }
            }
        }

        private static void ShowHelp()
        {
            Console.WriteLine("Hello World Application (C#)");
            Console.WriteLine("Usage: HelloWorld [options]");
            Console.WriteLine("Options:");
            Console.WriteLine("  -m, --message <text>  Custom message to display");
            Console.WriteLine("  --no-log              Disable logging");
            Console.WriteLine("  -h, --help            Show this help message");
        }

        private static void DisplayMessage()
        {
            Console.WriteLine(_config.Message);
        }

        private static void LogMessage()
        {
            try
            {
                if (!Directory.Exists(_config.LogPath))
                {
                    Directory.CreateDirectory(_config.LogPath);
                }

                string logFile = Path.Combine(_config.LogPath, $"hello_{DateTime.Now:yyyyMMdd}.log");
                string logEntry = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {_config.Message}{Environment.NewLine}";
                File.AppendAllText(logFile, logEntry);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Warning: Could not write to log: {ex.Message}");
            }
        }
    }
}