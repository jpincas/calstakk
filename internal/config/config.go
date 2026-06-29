package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	"github.com/pelletier/go-toml/v2"
)

const (
	DefaultHost    = "127.0.0.1"
	DefaultPort    = 5232
	DefaultDataDir = "" // resolved at runtime to ~/.local/share/calstakk
)

// Config holds all runtime configuration.
type Config struct {
	Server ServerConfig `toml:"server"`
	Client ClientConfig `toml:"client"`
}

type ServerConfig struct {
	Host    string `toml:"host"`
	Port    int    `toml:"port"`
	DataDir string `toml:"data_dir"`
	WebDir  string `toml:"web_dir"`
}

type ClientConfig struct {
	ServerURL string `toml:"server_url"`
}

// Load returns the effective Config after applying:
// config file (if present) → env vars → caller-supplied overrides.
// The overrideServerURL and overridePort arguments are set to their zero
// values when no override was supplied by the caller.
func Load(overrideServerURL string, overridePort int) (*Config, error) {
	cfg := defaults()

	if err := loadFile(cfg); err != nil {
		return nil, err
	}

	loadEnv(cfg)

	if overrideServerURL != "" {
		cfg.Client.ServerURL = overrideServerURL
	}
	if overridePort != 0 {
		cfg.Server.Port = overridePort
	}

	if err := resolve(cfg); err != nil {
		return nil, err
	}

	return cfg, nil
}

func defaults() *Config {
	return &Config{
		Server: ServerConfig{
			Host:    DefaultHost,
			Port:    DefaultPort,
			DataDir: "",
		},
		Client: ClientConfig{
			ServerURL: fmt.Sprintf("http://%s:%d", DefaultHost, DefaultPort),
		},
	}
}

func loadFile(cfg *Config) error {
	path, err := configFilePath()
	if err != nil {
		return err
	}

	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("reading config file: %w", err)
	}

	return toml.Unmarshal(data, cfg)
}

func loadEnv(cfg *Config) {
	if v := os.Getenv("CALSTAKK_SERVER_HOST"); v != "" {
		cfg.Server.Host = v
	}
	if v := os.Getenv("CALSTAKK_SERVER_PORT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			cfg.Server.Port = n
		}
	}
	if v := os.Getenv("CALSTAKK_DATA_DIR"); v != "" {
		cfg.Server.DataDir = v
	}
	if v := os.Getenv("CALSTAKK_SERVER_URL"); v != "" {
		cfg.Client.ServerURL = v
	}
	if v := os.Getenv("CALSTAKK_WEB_DIR"); v != "" {
		cfg.Server.WebDir = v
	}
}

func resolve(cfg *Config) error {
	if cfg.Server.DataDir == "" {
		dir, err := defaultDataDir()
		if err != nil {
			return err
		}
		cfg.Server.DataDir = dir
	}

	if cfg.Client.ServerURL == fmt.Sprintf("http://%s:%d", DefaultHost, DefaultPort) {
		cfg.Client.ServerURL = fmt.Sprintf("http://%s:%d", cfg.Server.Host, cfg.Server.Port)
	}

	return nil
}

func configFilePath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("finding config dir: %w", err)
	}
	return filepath.Join(dir, "calstakk", "config.toml"), nil
}

func defaultDataDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("finding home dir: %w", err)
	}
	return filepath.Join(home, ".local", "share", "calstakk"), nil
}
